const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

assert.ok(
  appSource.includes('const modal = Antd && Antd.Modal ? Antd.Modal : null;')
    && appSource.includes('function confirmTaskStart')
    && appSource.includes("确认开始")
    && appSource.includes('await confirmTaskStart'),
  'Starting collection, product, and flash tasks should show a confirmation dialog before posting.',
);

assert.ok(
  appSource.includes("const logViewMode = ref('useful')")
    && appSource.includes('const logViewOptions')
    && appSource.includes('const usefulLogs = computed')
    && appSource.includes('const errorLogs = computed')
    && appSource.includes('class="log-filter-row"')
    && appSource.includes('关键日志')
    && appSource.includes('错误日志')
    && appSource.includes('完整日志'),
  'Run logs should be split into useful, error, and complete views.',
);

assert.ok(
  appSource.includes('v-if="!displayRun" class="run-idle-state"')
    && appSource.includes('等待任务开始')
    && appSource.includes('<template v-else>')
    && appSource.indexOf('v-if="!displayRun" class="run-idle-state"') < appSource.indexOf('class="metrics-row"'),
  'Run status should show a compact idle state before a task starts instead of zero metrics.',
);

assert.ok(
  appSource.includes('const collectProgress = computed')
    && appSource.includes('const flashProgress = computed')
    && appSource.includes('class="module-progress-panel collect-progress-panel"')
    && appSource.includes('当前采集对象')
    && appSource.includes('采集进度')
    && appSource.includes('class="module-progress-panel flash-progress-panel"')
    && appSource.includes('当前秒杀活动')
    && appSource.includes('活动进度'),
  'Run status should show module-specific progress for collection and flash-sale tasks.',
);

assert.ok(
  appSource.includes("const historyStatusFilter = ref('all')")
    && appSource.includes('const historyStatusFilterOptions')
    && appSource.includes('const filteredVisibleHistory')
    && appSource.includes('class="history-filter-row"')
    && appSource.includes('全部记录')
    && appSource.includes('成功')
    && appSource.includes('失败')
    && appSource.includes('已停止')
    && appSource.includes(':data-source="filteredVisibleHistory"'),
  'Recent history should support status filtering before rendering the list.',
);

assert.ok(
  appSource.includes("const configActiveTab = ref('miaoshou')")
    && appSource.includes('class="config-tabs"')
    && appSource.includes('<a-tabs v-model:active-key="configActiveTab"')
    && appSource.includes('v-for="section in configSections"')
    && appSource.includes('AI 功能说明'),
  'Account configuration should be split into tabs by config section.',
);

assert.ok(
  styles.includes('.log-filter-row')
    && styles.includes('.history-filter-row')
    && /\.history-filter-row \.medium-radio-group\s*\{[^}]*grid-template-columns:\s*repeat\(4, max-content\);/.test(styles)
    && styles.includes('.run-idle-state')
    && styles.includes('.module-progress-panel')
    && styles.includes('.module-progress-item')
    && styles.includes('.config-tabs')
    && styles.includes('.config-tab-panel'),
  'Workflow UI optimizations should include layout styles for new controls.',
);

console.log('workflow UI optimization checks passed');
