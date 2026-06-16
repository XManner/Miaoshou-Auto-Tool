const { failureTypeLabel } = require('./run_failure_classification');

function formatDuration(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  if (totalSeconds >= 3600) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}时${minutes}分`;
  }
  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}分${seconds}秒`;
  }
  return `${totalSeconds}秒`;
}

function buildFailureRanking(history = []) {
  const counts = new Map();
  for (const item of Array.isArray(history) ? history : []) {
    if (!item || !['error', 'stopped'].includes(String(item.status || ''))) {
      continue;
    }
    const type = String(item.diagnosticFailureType || (item.status === 'stopped' ? 'stopped' : 'unknown'));
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({
      type,
      label: failureTypeLabel(type),
      count,
    }));
}

function buildRunStats(history = []) {
  const rows = Array.isArray(history) ? history : [];
  const totalRuns = rows.length;
  const successRuns = rows.filter((item) => item && item.status === 'success').length;
  const failedRuns = rows.filter((item) => item && item.status === 'error').length;
  const stoppedRuns = rows.filter((item) => item && item.status === 'stopped').length;
  const durations = rows
    .map((item) => Number(item && item.durationMs))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const averageDurationMs = durations.length > 0
    ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
    : 0;
  const successRate = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 0;

  return {
    totalRuns,
    successRuns,
    failedRuns,
    stoppedRuns,
    successRate,
    successRateText: `${successRate}%`,
    averageDurationMs,
    averageDurationText: formatDuration(averageDurationMs),
    failureRanking: buildFailureRanking(rows),
  };
}

module.exports = {
  buildRunStats,
  buildFailureRanking,
  formatDuration,
};
