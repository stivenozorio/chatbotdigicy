'use strict';

const { runReport, AnalyticsError } = require('../services/analyticsData');

const MAX_DAYS = 90;
const DEFAULT_DAYS = 7;

function publicMessage(err) {
  if (!(err instanceof AnalyticsError)) return 'Error interno del servidor';
  if (err.code === 'NOT_CONFIGURED') return 'El servicio de estadísticas no está disponible.';
  if (err.code === 'TIMEOUT') return 'Google tardó demasiado en responder. Intenta de nuevo.';
  return 'No se pudieron obtener las estadísticas. Intenta de nuevo.';
}

function parseDays(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAYS;
  return Math.min(Math.round(n), MAX_DAYS);
}

function metricValue(row, index) {
  const v = row && row.metricValues && row.metricValues[index] && row.metricValues[index].value;
  return v ? Number(v) : 0;
}

// Desglose de contact_click por "method" (whatsapp/call/email) -- depende
// de una dimensión personalizada que no existe hasta que se crea a mano en
// GA4 (Admin -> Custom definitions, scope Event, parámetro "method"). Si
// todavía no existe, Google responde con un error de dimensión inválida;
// se captura aparte para que el resto del resumen no se caiga por eso.
async function getContactByMethod(dateRange) {
  try {
    const report = await runReport({
      dateRanges: [dateRange],
      dimensions: [{ name: 'customEvent:method' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', stringFilter: { value: 'contact_click' } },
      },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    });
    return (report.rows || [])
      .map((row) => ({ method: row.dimensionValues[0].value, count: metricValue(row, 0) }))
      .filter((row) => row.method);
  } catch (err) {
    console.error('contact_click por método no disponible todavía (¿falta la dimensión personalizada "method" en GA4?):', err && err.code);
    return null;
  }
}

exports.summary = async (req, res) => {
  const days = parseDays(req.query.days);
  const dateRange = { startDate: `${days}daysAgo`, endDate: 'today' };

  try {
    const [totalsReport, eventsReport, contactByMethod] = await Promise.all([
      runReport({
        dateRanges: [dateRange],
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'eventCount' }],
      }),
      runReport({
        dateRanges: [dateRange],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 15,
      }),
      getContactByMethod(dateRange),
    ]);

    const totalsRow = totalsReport.rows && totalsReport.rows[0];
    const totals = {
      activeUsers: metricValue(totalsRow, 0),
      pageViews: metricValue(totalsRow, 1),
      eventCount: metricValue(totalsRow, 2),
    };

    const events = (eventsReport.rows || []).map((row) => ({
      name: row.dimensionValues[0].value,
      count: metricValue(row, 0),
    }));

    res.json({ days, totals, events, contactByMethod });
  } catch (err) {
    const status = err instanceof AnalyticsError ? err.status : 500;
    if (err instanceof AnalyticsError) {
      console.error(`Fallo en /api/analytics/summary: ${err.code} - ${err.detail}`);
    } else {
      console.error('Fallo en /api/analytics/summary: ERROR_DESCONOCIDO', err && err.name);
    }
    res.status(status).json({ error: publicMessage(err) });
  }
};
