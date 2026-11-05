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

exports.summary = async (req, res) => {
  const days = parseDays(req.query.days);
  const dateRange = { startDate: `${days}daysAgo`, endDate: 'today' };

  try {
    const [totalsReport, eventsReport] = await Promise.all([
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

    res.json({ days, totals, events });
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
