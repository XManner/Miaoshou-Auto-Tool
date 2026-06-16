(function () {
  const { createApp, ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch, h } = Vue;
  const Antd = window.antd || window.AntDesignVue;
  const message = Antd && Antd.message ? Antd.message : null;
  const modal = Antd && Antd.Modal ? Antd.Modal : null;

  const THEME_OPTIONS = [
    { value: 'commerce', label: '科技蓝', primary: '#1677ff', accent: '#4096ff' },
    { value: 'tech', label: '科技风', primary: '#ff4d4f', accent: '#ff7875' },
    { value: 'fresh', label: '清新风', primary: '#16a34a', accent: '#f59e0b' },
  ];

  const STATUS_TEXT = {
    running: '执行中',
    success: '完成',
    error: '失败',
    stopped: '已停止',
    ready: '空闲',
  };

  const FAILURE_TYPE_TEXT = {
    captcha: '验证码',
    login: '登录失效',
    network: '网络/妙手服务异常',
    selector: '页面元素找不到',
    data: '商品/活动数据异常',
    stopped: '人工停止',
    timeout: '超时',
    unknown: '未知错误',
  };

  const PAGE_TITLES = {
    home: '首页',
    collect: '商品采集',
    products: '编辑商品',
    flash: '秒杀管理',
    config: '账户配置',
  };
  const DOCUMENT_TITLE_PREFIX = 'TikTok Shop丨妙手自动化工作台';

  function buildDocumentTitle(page) {
    const title = PAGE_TITLES[page] || PAGE_TITLES.home;
    return `${DOCUMENT_TITLE_PREFIX}丨${title}`;
  }

  function normalizeThemeName(value) {
    return THEME_OPTIONS.some((item) => item.value === value) ? value : THEME_OPTIONS[0].value;
  }

  function maskPhoneText(value) {
    return String(value || '').replace(/(\d{3})\d{4}(\d{4})/g, '$1****$2');
  }

  function formatDate(value) {
    if (!value) {
      return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  function formatTime(value) {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleTimeString('zh-CN', { hour12: false });
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}时${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`;
    }
    if (minutes > 0) {
      return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
    }
    return `${seconds}秒`;
  }

  function numberText(value, fallback = '-') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeMetricCount(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || Object.is(numeric, -0)) {
      return 0;
    }
    return Math.max(0, numeric);
  }

  function successfulCount(summary) {
    if (!summary) {
      return 0;
    }
    if (Number.isFinite(Number(summary.successCount))) {
      return normalizeMetricCount(summary.successCount);
    }
    const total = Number(summary.totalCount);
    const failed = Number(summary.failureCount);
    if (Number.isFinite(total) && Number.isFinite(failed)) {
      return normalizeMetricCount(total - failed);
    }
    return 0;
  }

  function failedCount(summary) {
    if (!summary) {
      return 0;
    }
    if (Number.isFinite(Number(summary.failureCount))) {
      return normalizeMetricCount(summary.failureCount);
    }
    const failedItems = Array.isArray(summary.failedItems) ? summary.failedItems.length : NaN;
    return Number.isFinite(failedItems) ? normalizeMetricCount(failedItems) : 0;
  }

  function firstFiniteMetric(...values) {
    for (const value of values) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return normalizeMetricCount(numeric);
      }
    }
    return 0;
  }

  function metricCountOrNull(...values) {
    for (const value of values) {
      if (value === null || value === undefined) {
        continue;
      }
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return normalizeMetricCount(numeric);
      }
    }
    return null;
  }

  function runDurationMs(run) {
    if (!run) {
      return 0;
    }
    if (run.durationMs !== null && run.durationMs !== undefined) {
      const finishedDuration = Number(run.durationMs);
      if (Number.isFinite(finishedDuration)) {
        return Math.max(0, finishedDuration);
      }
    }
    if (run.status === 'running' && run.startedAt) {
      const startedAt = new Date(run.startedAt).getTime();
      if (Number.isFinite(startedAt)) {
        return Math.max(0, Date.now() - startedAt);
      }
    }
    return 0;
  }

  function buildRunMetrics(run, summary) {
    if (!run) {
      return {
        totalCount: 0,
        successCount: 0,
        failureCount: 0,
        durationText: '0秒',
      };
    }

    const progress = run.progress || {};
    const running = run.status === 'running';
    const totalCount = running
      ? firstFiniteMetric(progress.totalCount, progress.total, summary && summary.totalCount, run.collectCount, run.flashCount, run.count)
      : firstFiniteMetric(summary && summary.totalCount, progress.totalCount, progress.total, run.collectCount, run.flashCount, run.count);
    const successCount = running
      ? firstFiniteMetric(progress.completed, progress.successCount, summary && summary.successCount)
      : successfulCount(summary);
    const failureCount = running
      ? firstFiniteMetric(progress.errorCount, progress.failureCount, summary && (summary.errorCount || summary.failureCount))
      : failedCount(summary);

    return {
      totalCount,
      successCount,
      failureCount,
      durationText: formatDuration(runDurationMs(run)),
    };
  }

  function statusColor(status) {
    if (status === 'running') {
      return 'processing';
    }
    if (status === 'success') {
      return 'success';
    }
    if (status === 'error') {
      return 'error';
    }
    if (status === 'stopped') {
      return 'default';
    }
    return 'default';
  }

  function buildHistoryResultMetrics(run, page) {
    const summary = pageSummary(run, page);
    const progress = run && run.progress ? run.progress : {};
    const failedItemsCount = summary && Array.isArray(summary.failedItems)
      ? summary.failedItems.length
      : null;
    const totalCount = metricCountOrNull(summary && summary.totalCount, progress.totalCount, progress.total);
    const failureCount = metricCountOrNull(
      summary && summary.failureCount,
      summary && summary.errorCount,
      failedItemsCount,
      progress.failureCount,
      progress.errorCount,
    );
    const successCount = metricCountOrNull(summary && summary.successCount, progress.successCount, progress.completed);
    if (totalCount === null && successCount === null && failureCount === null) {
      return null;
    }
    const resolvedFailure = failureCount === null ? 0 : failureCount;
    const resolvedSuccess = successCount === null
      ? (totalCount === null ? 0 : normalizeMetricCount(totalCount - resolvedFailure))
      : successCount;
    const resolvedTotal = totalCount === null ? resolvedSuccess + resolvedFailure : totalCount;
    if (!summary && resolvedTotal === 0 && resolvedSuccess === 0 && resolvedFailure === 0) {
      return null;
    }
    return {
      totalCount: resolvedTotal,
      successCount: resolvedSuccess,
      failureCount: resolvedFailure,
    };
  }

  function buildHistoryResultText(run, page) {
    if (!run || run.status === 'running') {
      return '';
    }
    const metrics = buildHistoryResultMetrics(run, page);
    if (!metrics) {
      return '';
    }
    const actionText = page === 'flash'
      ? `处理 ${metrics.totalCount} 个秒杀活动`
      : `编辑 ${metrics.totalCount} 个商品`;
    return `（${actionText}，成功 ${metrics.successCount} 个，失败 ${metrics.failureCount} 个）`;
  }

  function buildTaskText(run) {
    if (!run) {
      return '等待选择任务。';
    }
    const tasks = run.tasks || {};
    if (tasks.collect) {
      return `商品采集 ${run.collectCount || run.count || 0} 个`;
    }
    const parts = [];
    if (tasks.edit !== false) {
      const editResultText = run.itemSelectionMode === 'all' ? buildHistoryResultText(run, 'products') : '';
      const selection = run.itemSelectionMode === 'all'
        ? '全部商品'
        : `${run.count || 0} 个商品`;
      parts.push(`编辑优化 ${selection}${editResultText}${run.publish ? '并发布' : '，不发布'}`);
    }
    if (tasks.flash) {
      const flashResultText = run.flashSelectionMode === 'all' ? buildHistoryResultText(run, 'flash') : '';
      parts.push(run.flashSelectionMode === 'all'
        ? `处理全部秒杀活动${flashResultText}`
        : `处理 ${run.flashCount || 0} 个秒杀活动`);
    }
    return parts.length > 0 ? parts.join('，') : '等待选择任务。';
  }

  function normalizeFlashActivityName(item) {
    if (!item || typeof item !== 'object') {
      return '';
    }
    const activityTitle = String(item.activityTitle || item.title || item.name || '').trim();
    if (activityTitle) {
      return activityTitle;
    }
    const activityId = String(item.activityId || item.detailId || item.id || '').trim();
    return activityId ? `活动 ${activityId}` : '';
  }

  function flashProcessedActivitiesText(item) {
    if (!item || !(item.tasks && item.tasks.flash)) {
      return '';
    }
    const summary = item.summary || {};
    const candidates = [
      ...(Array.isArray(item.processedFlashActivities) ? item.processedFlashActivities : []),
      ...(Array.isArray(summary.results) ? summary.results : []),
      ...(summary.flash && Array.isArray(summary.flash.results) ? summary.flash.results : []),
    ];
    const names = [];
    const seen = new Set();
    candidates.forEach((entry) => {
      const name = normalizeFlashActivityName(entry);
      if (!name || seen.has(name)) {
        return;
      }
      seen.add(name);
      names.push(name);
    });
    if (names.length === 0) {
      return '';
    }
    return `已处理活动：${names.join('、')}`;
  }

  function flashSelectionText(mode, count) {
    return mode === 'all' ? '全部秒杀活动' : `${Math.max(1, Number(count || 1))} 个秒杀活动`;
  }

  function runHasEditTask(run) {
    return Boolean(run && (!run.tasks || (run.tasks && run.tasks.edit !== false)));
  }

  function runHasCollectTask(run) {
    return Boolean(run && run.tasks && run.tasks.collect);
  }

  function runHasFlashTask(run) {
    return Boolean(run && run.tasks && run.tasks.flash);
  }

  function runIsFlashPhase(run) {
    const progress = run && run.progress ? run.progress : {};
    const phase = String(progress.phase || '');
    const phaseLabel = String(progress.phaseLabel || '');
    return phase === 'flash' || phaseLabel.includes('秒杀');
  }

  function runHasFlashResult(run) {
    return Boolean(run && (
      run.flashSummary
      || (run.summary && run.summary.flash)
      || (runHasFlashTask(run) && !runHasEditTask(run) && run.summary)
    ));
  }

  function runMatchesPage(run, page) {
    if (!run || page === 'home') {
      return false;
    }
    const hasEdit = runHasEditTask(run);
    const hasCollect = runHasCollectTask(run);
    const hasFlash = runHasFlashTask(run);
    const flashPhaseOrResult = runIsFlashPhase(run) || runHasFlashResult(run);
    if (page === 'collect') {
      return hasCollect;
    }
    if (page === 'flash') {
      return hasFlash && (!hasEdit || flashPhaseOrResult);
    }
    if (page === 'products') {
      return hasEdit && !hasCollect && (!hasFlash || !flashPhaseOrResult);
    }
    return false;
  }

  function pageSummary(run, page) {
    if (!run) {
      return null;
    }
    if (page === 'flash') {
      return run.flashSummary || (run.summary && run.summary.flash) || run.summary || null;
    }
    if (page === 'collect') {
      return run.collectSummary || (run.summary && run.summary.collect) || run.summary || null;
    }
    if (page === 'products') {
      return run.editSummary || (run.summary && run.summary.edit) || run.summary || null;
    }
    return run.summary || null;
  }

  function formatCollectPrice(value) {
    const price = Number(value);
    return Number.isFinite(price) ? `¥${price.toFixed(2)}` : '未识别';
  }

  function formatCollectWeight(value) {
    const grams = Number(value);
    return Number.isFinite(grams) && grams > 0 ? `${Number(grams.toFixed(1)).toString()}g` : '未识别';
  }

  function collectHistoryItemsFromRuns(runs = []) {
    const items = [];
    for (const run of runs) {
      if (!runHasCollectTask(run)) {
        continue;
      }
      const summary = pageSummary(run, 'collect') || {};
      const results = Array.isArray(summary.results) ? summary.results : [];
      results.forEach((item, index) => {
        if (!item || item.error) {
          return;
        }
        items.push({
          id: `${run.id || run.startedAt || 'collect'}-${index}`,
          title: item.title || '未命名商品',
          url: item.url || '',
          price: item.price,
          weightGrams: item.weightGrams,
          weightText: item.weightText || '',
          keyword: item.keyword || '',
          score: item.score,
          startedAt: run.startedAt,
        });
      });
    }
    return items.slice(0, 80);
  }

  function pageLogs(run, page) {
    const logs = run && Array.isArray(run.logs) ? run.logs : [];
    if (page !== 'flash') {
      return logs;
    }
    const flashStartIndex = logs.findIndex((entry) => (
      /秒杀活动|开始执行秒杀活动|计划处理秒杀/.test(String(entry && entry.text ? entry.text : ''))
    ));
    return flashStartIndex >= 0 ? logs.slice(flashStartIndex) : logs;
  }

  function logClass(entry) {
    if (!entry) {
      return '';
    }
    if (entry.stream === 'stderr') {
      return 'log-line danger';
    }
    if (entry.stream === 'system') {
      return 'log-line system';
    }
    return 'log-line';
  }

  function isErrorLogEntry(entry = {}) {
    const text = `${entry.stream || ''} ${entry.text || ''}`;
    return entry.stream === 'stderr' || /(error|failed|失败|错误|异常|超时|验证码|登录|中断|停止)/i.test(text);
  }

  function isUsefulLogEntry(entry = {}) {
    const text = `${entry.stream || ''} ${entry.text || ''}`;
    return isErrorLogEntry(entry)
      || /(开始|完成|当前|进度|成功|已添加|已保存|已发布|已采集|准备|继续|等待|筛选|处理|跳过|诊断)/i.test(text);
  }

  function historyStatusMatches(run = {}, filter = 'all') {
    if (filter === 'all') {
      return true;
    }
    if (filter === 'failed') {
      return run.status === 'error';
    }
    return run.status === filter;
  }

  function historyPageForRun(run) {
    if (runHasCollectTask(run)) {
      return 'collect';
    }
    if (runHasFlashTask(run) && !runHasEditTask(run)) {
      return 'flash';
    }
    return 'products';
  }

  function normalizeApiError(error) {
    return maskPhoneText(error && error.message ? error.message : String(error || '请求失败'));
  }

  const app = createApp({
    setup() {
      const currentPage = ref(window.localStorage.getItem('miaoshou-active-page') || 'home');
      const themeName = ref(normalizeThemeName(window.localStorage.getItem('miaoshou-theme') || 'commerce'));
      const accounts = ref([]);
      const configStatus = ref({ sections: [], envPath: '' });
      const useLocalEnv = ref(true);
      const currentRun = ref(null);
      const history = ref([]);
      const queue = ref([]);
      const queuePaused = ref(true);
      const dashboardStats = ref({ totalRuns: 0, successRateText: '0%', averageDurationText: '0秒', failureRanking: [] });
      const serverCapabilities = ref({ collectSources: [] });
      const statusTimer = ref(null);
      const captchaCode = ref('');
      const logBox = ref(null);
      const logPinned = ref(true);
      const loading = ref(false);
      const logViewMode = ref('useful');
      const historyStatusFilter = ref('all');
      const configActiveTab = ref('miaoshou');
      const logViewOptions = [
        { value: 'useful', label: '关键日志' },
        { value: 'errors', label: '错误日志' },
        { value: 'all', label: '完整日志' },
      ];
      const historyStatusFilterOptions = [
        { value: 'all', label: '全部记录' },
        { value: 'success', label: '成功' },
        { value: 'failed', label: '失败' },
        { value: 'stopped', label: '已停止' },
      ];

      const productForm = reactive({
        itemSelectionMode: 'all',
        itemStartIndex: 1,
        count: 1,
        publish: false,
        processingMode: 'precise',
        sourcePriceExtraCny: 0,
        weightPaddingGrams: 30,
        buyOneTakeOne: false,
        runFlashAfterEdit: false,
        productFlashSelectionMode: 'all',
        flashCount: 1,
      });

      const collectForm = reactive({
        mode: 'auto',
        source: '1688',
        shopeeSite: 'my',
        shopeeMaxPrice: 10000,
        shopeeMaxMoq: 3,
        keywords: '',
        links: '',
        count: 1,
        dedupeWindowDays: 7,
        maxPriceCny: 10,
        amazonMaxPriceUsd: 10000,
        amazonMinRating: 0,
        amazonMinReviewCount: 0,
        preferredTerms: '',
        excludedTerms: '',
        minScore: 50,
        safeMode: false,
      });

      const flashForm = reactive({
        flashSelectionMode: 'all',
        flashCount: 1,
      });

      const configForm = reactive({});
      const miaoshouAccountForm = ref([]);
      const selectedConfigAccountIndex = ref(0);
      const configDirty = ref(false);
      const configAccountsTouched = ref(false);

      const themeOption = computed(() => (
        THEME_OPTIONS.find((item) => item.value === themeName.value) || THEME_OPTIONS[0]
      ));

      const antTheme = computed(() => ({
        token: {
          colorPrimary: themeOption.value.primary,
          colorLink: themeOption.value.primary,
          borderRadius: 8,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
      }));

      const pageTitle = computed(() => PAGE_TITLES[currentPage.value] || PAGE_TITLES.home);
      const pageSubtitle = computed(() => {
        if (currentPage.value === 'collect') {
          return '从 1688 或 Amazon.com 筛选商品，并通过妙手开放 API 采集到 TikTok 采集箱。';
        }
        if (currentPage.value === 'products') {
          return '编辑优化商品，可选择是否发布，并可继续执行秒杀活动。';
        }
        if (currentPage.value === 'flash') {
          return '处理进行中的秒杀活动，自动添加商品并设置折扣。';
        }
        if (currentPage.value === 'config') {
          return '集中配置妙手账号、登录密码和 AI Key。';
        }
        return '查看最近执行过的任务记录。';
      });
      const isRunning = computed(() => currentRun.value && currentRun.value.status === 'running');
      const displayRun = computed(() => runMatchesPage(currentRun.value, currentPage.value) ? currentRun.value : null);
      const isPageRunning = computed(() => displayRun.value && displayRun.value.status === 'running');
      const runSummary = computed(() => pageSummary(displayRun.value, currentPage.value));
      const runProgress = computed(() => displayRun.value && displayRun.value.progress ? displayRun.value.progress : null);
      const runMetrics = computed(() => buildRunMetrics(displayRun.value, runSummary.value));
      const progressPercent = computed(() => {
        const progress = runProgress.value;
        if (!progress) {
          return 0;
        }
        return Math.max(0, Math.min(100, Number(progress.overallPercent || 0)));
      });
      const productProgress = computed(() => {
        const progress = runProgress.value || {};
        const detailId = String(runProgress.value && runProgress.value.detailId ? runProgress.value.detailId : '').trim();
        const completed = metricCountOrNull(progress.completed);
        const total = metricCountOrNull(progress.totalCount, progress.total);
        const currentItem = detailId
          ? `商品 ${detailId}`
          : (isPageRunning.value ? '正在读取商品' : '等待开始');
        const completedText = completed === null ? 0 : completed;
        const totalText = total === null ? 0 : total;
        return {
          currentItem,
          currentProgress: `${completedText} / ${totalText}`,
          totalProgress: `${Math.round(progressPercent.value)}%`,
        };
      });
      const collectProgress = computed(() => {
        const run = displayRun.value || {};
        const progress = runProgress.value || {};
        const source = run.collectSource || collectForm.source || '1688';
        const sourceLabel = source === 'amazon'
          ? 'Amazon.com'
          : (source === 'links' ? '链接采集' : '1688');
        const detailId = String(progress.detailId || '').trim();
        const completed = metricCountOrNull(progress.completed);
        const total = metricCountOrNull(progress.totalCount, progress.total, run.collectCount);
        const currentTarget = detailId
          ? `商品 ${detailId}`
          : (isPageRunning.value ? (progress.phaseLabel || '正在采集') : '等待开始');
        return {
          sourceLabel,
          currentTarget,
          currentProgress: `${completed === null ? 0 : completed} / ${total === null ? 0 : total}`,
        };
      });
      const flashProgress = computed(() => {
        const run = displayRun.value || {};
        const progress = runProgress.value || {};
        const activityId = String(progress.detailId || '').trim();
        const activityName = String(progress.detailName || '').trim();
        const completed = metricCountOrNull(progress.completed);
        const total = metricCountOrNull(progress.totalCount, progress.total, run.flashCount);
        const currentActivity = activityName || (activityId
          ? `活动 ${activityId}`
          : (isPageRunning.value ? (progress.phaseLabel || '正在处理秒杀') : '等待开始'));
        return {
          currentActivity,
          activityProgress: `${completed === null ? 0 : completed} / ${total === null ? 0 : total}`,
          totalProgress: `${Math.round(progressPercent.value)}%`,
        };
      });
      const allRunLogs = computed(() => pageLogs(displayRun.value, currentPage.value));
      const usefulLogs = computed(() => allRunLogs.value.filter((entry) => isUsefulLogEntry(entry)));
      const errorLogs = computed(() => allRunLogs.value.filter((entry) => isErrorLogEntry(entry)));
      const visibleLogs = computed(() => {
        if (logViewMode.value === 'all') {
          return allRunLogs.value;
        }
        if (logViewMode.value === 'errors') {
          return errorLogs.value;
        }
        return usefulLogs.value;
      });
      const logEmptyText = computed(() => {
        if (allRunLogs.value.length === 0) {
          return '等待执行...';
        }
        if (logViewMode.value === 'errors') {
          return '暂无错误日志';
        }
        if (logViewMode.value === 'useful') {
          return '暂无关键日志，可切换完整日志查看全部内容';
        }
        return '暂无日志';
      });
      const hasLogs = computed(() => allRunLogs.value.length > 0);
      const hasHistory = computed(() => history.value.length > 0);
      const visibleHistory = computed(() => {
        if (currentPage.value === 'home') {
          return history.value;
        }
        return history.value.filter((run) => historyPageForRun(run) === currentPage.value);
      });
      const filteredVisibleHistory = computed(() => (
        visibleHistory.value.filter((run) => historyStatusMatches(run, historyStatusFilter.value))
      ));
      const hasVisibleHistory = computed(() => filteredVisibleHistory.value.length > 0);
      const collectHistoryItems = computed(() => collectHistoryItemsFromRuns(history.value));
      const queueItems = computed(() => queue.value);
      const activeQueueItem = computed(() => {
        const run = currentRun.value || {};
        if (!run.queueLabel || !isRunActive(run)) {
          return null;
        }
        return {
          id: `active-${run.id}`,
          status: 'running',
          label: run.queueLabel,
          createdAt: run.startedAt || '',
          position: 1,
          account: run.queueAccount || run.account || null,
        };
      });
      const queueDisplayItems = computed(() => {
        const runningItem = activeQueueItem.value ? [activeQueueItem.value] : [];
        const offset = runningItem.length;
        return runningItem.concat(queueItems.value.map((item, index) => ({
          ...item,
          position: index + 1 + offset,
        })));
      });
      const queueStatusText = computed(() => (queuePaused.value ? '等待开始' : '执行中'));
      const queueCountText = computed(() => `${queueItems.value.length} 个`);
      const failureRanking = computed(() => (
        dashboardStats.value && Array.isArray(dashboardStats.value.failureRanking)
          ? dashboardStats.value.failureRanking
          : []
      ));
      const homeDisplayRun = computed(() => currentRun.value || null);
      const homeRunPage = computed(() => (
        homeDisplayRun.value ? historyPageForRun(homeDisplayRun.value) : 'products'
      ));
      const homeRunProgress = computed(() => (
        homeDisplayRun.value && homeDisplayRun.value.progress ? homeDisplayRun.value.progress : null
      ));
      const homeRunSummary = computed(() => (
        homeDisplayRun.value ? pageSummary(homeDisplayRun.value, homeRunPage.value) : null
      ));
      const homeRunMetrics = computed(() => buildRunMetrics(homeDisplayRun.value, homeRunSummary.value));
      const homeProgressPercent = computed(() => {
        const progress = homeRunProgress.value;
        if (!progress) {
          return 0;
        }
        return Math.max(0, Math.min(100, Number(progress.overallPercent || 0)));
      });
      const homeRunStatusText = computed(() => (
        homeDisplayRun.value ? (STATUS_TEXT[homeDisplayRun.value.status] || homeDisplayRun.value.status) : '等待开始'
      ));
      const homeRunTitle = computed(() => (
        homeDisplayRun.value ? buildTaskText(homeDisplayRun.value) : '暂无运行任务'
      ));
      const homeRunSubtitle = computed(() => {
        const run = homeDisplayRun.value;
        if (!run) {
          return '配置好采集、编辑或秒杀任务后，可以直接开始，也可以加入队列按顺序执行。';
        }
        const phase = homeRunProgress.value && homeRunProgress.value.phaseLabel
          ? homeRunProgress.value.phaseLabel
          : homeRunStatusText.value;
        const account = run.account && run.account.label
          ? maskPhoneText(run.account.label)
          : (defaultAccount.value ? maskPhoneText(defaultAccount.value.label) : '-');
        return `${phase} · 账号 ${account}`;
      });
      const homeRecentItems = computed(() => filteredVisibleHistory.value.slice(0, 6));
      const homeFailureCount = computed(() => failureRanking.value.reduce((total, item) => total + Number(item.count || 0), 0));
      const homeUsefulLogs = computed(() => {
        const logs = homeDisplayRun.value && Array.isArray(homeDisplayRun.value.logs) ? homeDisplayRun.value.logs : [];
        return logs.filter((entry) => isUsefulLogEntry(entry)).slice(-5);
      });
      const collectLinkList = computed(() => String(collectForm.links || '')
        .split(/[\s,，、]+/)
        .map((item) => item.trim())
        .filter(Boolean));
      const supportsAmazonCollection = computed(() => {
        const capabilities = serverCapabilities.value || {};
        const sources = Array.isArray(capabilities.collectSources) ? capabilities.collectSources : [];
        return Boolean(capabilities.amazonCollection && sources.includes('amazon'));
      });
      const configSections = computed(() => (
        configStatus.value && Array.isArray(configStatus.value.sections)
          ? configStatus.value.sections
          : []
      ));
      const aiUsageItems = computed(() => (
        configStatus.value && Array.isArray(configStatus.value.aiUsage)
          ? configStatus.value.aiUsage
          : []
      ));
      const configAccountOptions = computed(() => miaoshouAccountForm.value.map((account, index) => ({
        value: index,
        label: maskPhoneText(account.loginPhone || account.label || `妙手账号 ${index + 1}`),
      })));
      const defaultAccount = computed(() => accounts.value.find((account) => account.active && account.complete) || accounts.value.find((account) => account.complete) || accounts.value[0] || null);
      const canSubmitCaptcha = computed(() => (
        displayRun.value
        && displayRun.value.captcha
        && displayRun.value.captcha.status === 'waiting'
        && captchaCode.value.trim()
      ));
      function configSectionFields(section = {}) {
        const groupFields = Array.isArray(section.groups)
          ? section.groups.flatMap((group) => (Array.isArray(group.fields) ? group.fields : []))
          : [];
        return groupFields.length > 0 ? groupFields : (Array.isArray(section.fields) ? section.fields : []);
      }
      function configRenderableGroups(section = {}) {
        if (Array.isArray(section.groups) && section.groups.length > 0) {
          return section.groups;
        }
        return [{
          key: `${section.key || 'config'}-default`,
          title: '',
          description: '',
          fields: Array.isArray(section.fields) ? section.fields : [],
          plain: true,
        }];
      }
      const productRangeEnd = computed(() => productForm.itemSelectionMode === 'all'
        ? 0
        : productForm.itemStartIndex + Math.max(1, productForm.count) - 1);
      const productTaskSummary = computed(() => {
        const account = defaultAccount.value ? maskPhoneText(defaultAccount.value.label) : '默认账号';
        const selection = productForm.itemSelectionMode === 'all'
          ? '全部商品'
          : `第 ${productForm.itemStartIndex}-${productRangeEnd.value} 个商品`;
        const publishText = productForm.publish ? '并发布' : '不发布';
        const flashText = productForm.runFlashAfterEdit
          ? `，完成后继续处理 ${flashSelectionText(productForm.productFlashSelectionMode, productForm.flashCount)}`
          : '';
        const offerText = productForm.buyOneTakeOne ? '，单 SKU 添加 Buy 1 Take 1' : '';
        return `使用 ${account}，编辑优化 ${selection}，${publishText}${offerText}${flashText}。`;
      });
      const collectTaskSummary = computed(() => {
        const account = defaultAccount.value ? maskPhoneText(defaultAccount.value.label) : '默认账号';
        const targetCount = collectForm.mode === 'links'
          ? collectLinkList.value.length
          : Math.max(1, Number(collectForm.count || 1));
        const dedupeText = `，最近 ${Math.max(1, Number(collectForm.dedupeWindowDays || 7))} 天已采集商品会跳过`;
        if (collectForm.mode === 'links') {
          return `使用 ${account}，链接采集 ${targetCount} 个商品链接${dedupeText}。`;
        }
        if (collectForm.source === 'amazon') {
          return `使用 ${account}，Amazon.com 关键词采集 ${targetCount} 个商品，最高展示价 ${collectForm.amazonMaxPriceUsd} USD，最低评分 ${collectForm.amazonMinRating}${dedupeText}。`;
        }
        return `使用 ${account}，自动采集 ${targetCount} 个 1688 商品，最高采购价 ${collectForm.maxPriceCny} 元，最低评分 ${collectForm.minScore}${dedupeText}。`;
      });
      const collectAlertMessage = computed(() => {
        if (collectForm.mode === 'links') {
          return '商品链接采集';
        }
        if (collectForm.source === 'amazon') {
          return 'Amazon.com 关键词采集';
        }
        return '1688 自动采集';
      });
      const collectAlertDescription = computed(() => {
        if (collectForm.mode === 'links') {
          return '粘贴商品链接，系统会直接通过妙手开放 API 采集到 TikTok 采集箱；如果妙手不支持某个平台或商品，页面会显示妙手返回的错误。';
        }
        if (collectForm.source === 'amazon') {
          return '按关键词打开 Amazon.com 搜索页，按展示价、评分、评论数和排除词做轻量筛选，再通过妙手开放 API 采集到 TikTok 采集箱。';
        }
        return '按关键词在 1688 搜索选品，按价格、评分、优先词、排除词和安全模式过滤，合格后通过妙手开放 API 采集并认领到 TikTok 采集箱。';
      });
      const flashTaskSummary = computed(() => {
        const account = defaultAccount.value ? maskPhoneText(defaultAccount.value.label) : '默认账号';
        return `使用 ${account}，只处理 ${flashSelectionText(flashForm.flashSelectionMode, flashForm.flashCount)}。`;
      });
      const productEditPreviewItems = computed(() => [
        `标题规则：${productForm.buyOneTakeOne ? '标题开头添加 Buy 1 Take 1' : '按原编辑逻辑处理标题'}`,
        `价格加价：${Number(productForm.sourcePriceExtraCny || 0).toFixed(2)} 元`,
        `重量加重：${Number(productForm.weightPaddingGrams || 0)} g`,
        `买一送一规格：${productForm.buyOneTakeOne ? '添加' : '不添加'}`,
        `发布开关：${productForm.publish ? '发布' : '不发布'}`,
      ]);

      function applyTheme() {
        const normalized = normalizeThemeName(themeName.value);
        if (themeName.value !== normalized) {
          themeName.value = normalized;
        }
        document.documentElement.dataset.theme = normalized;
        window.localStorage.setItem('miaoshou-theme', normalized);
      }

      function setCurrentPage(page) {
        currentPage.value = page;
        window.localStorage.setItem('miaoshou-active-page', currentPage.value);
      }

      async function confirmLeaveConfigIfNeeded(targetPage) {
        if (currentPage.value !== 'config' || targetPage === 'config' || !configDirty.value) {
          return true;
        }
        const shouldSave = window.confirm('账户配置尚未保存。点击“确定”保存后离开，点击“取消”不保存直接离开。');
        if (!shouldSave) {
          return true;
        }
        return await saveConfig();
      }

      async function switchPage(page) {
        if (!page || page === currentPage.value) {
          return;
        }
        const canLeave = await confirmLeaveConfigIfNeeded(page);
        if (!canLeave) {
          return;
        }
        setCurrentPage(page);
      }

      async function goPage(event) {
        await switchPage(event.key);
      }

      async function navigateToPage(page) {
        await switchPage(page);
      }

      function updateDocumentTitle(page = currentPage.value) {
        document.title = buildDocumentTitle(page);
      }

      function notify(type, text) {
        if (message && message[type]) {
          message[type](text);
          return;
        }
        if (type === 'error') {
          window.alert(text);
        }
      }

      function buildConfirmTaskContent(summary, details = []) {
        const visibleDetails = details.filter(Boolean);
        if (!modal || !modal.confirm || !h) {
          return [summary, ...visibleDetails].filter(Boolean).join('\n');
        }
        return h('div', { class: 'confirm-task-content' }, [
          summary ? h('p', { class: 'confirm-task-summary' }, summary) : null,
          visibleDetails.length
            ? h('div', { class: 'confirm-task-details' }, visibleDetails.map((item) => (
              h('div', { class: 'confirm-task-detail' }, item)
            )))
            : null,
        ]);
      }

      function confirmTaskStart({ title, summary, details = [] }) {
        const textContent = [summary, ...details].filter(Boolean).join('\n');
        const content = buildConfirmTaskContent(summary, details);
        if (modal && modal.confirm) {
          return new Promise((resolve) => {
            modal.confirm({
              title,
              content,
              okText: '确认开始',
              cancelText: '取消',
              onOk: () => resolve(true),
              onCancel: () => resolve(false),
            });
          });
        }
        return Promise.resolve(window.confirm(`${title}\n\n${textContent}`));
      }

      async function runPrecheck(payload) {
        const result = await requestJson('/api/run/precheck', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return result.precheck || { ok: false, blockers: ['预检失败。'], warnings: [], preview: { lines: [] } };
      }

      function formatPrecheckDetails(precheck) {
        const details = [];
        const blockers = Array.isArray(precheck && precheck.blockers) ? precheck.blockers : [];
        const warnings = Array.isArray(precheck && precheck.warnings) ? precheck.warnings : [];
        const preview = precheck && precheck.preview ? precheck.preview : {};
        const previewLines = Array.isArray(preview.lines) ? preview.lines : [];
        if (blockers.length > 0) {
          details.push(`预检阻止：${blockers.join('；')}`);
        }
        if (warnings.length > 0) {
          details.push(`预检提醒：${warnings.join('；')}`);
        }
        if (previewLines.length > 0) {
          details.push(`变更预览：${previewLines.join('；')}`);
        }
        return details;
      }

      function collectConfirmationDetails() {
        if (collectForm.mode === 'links') {
          return ['链接采集会直接提交已填写的商品链接。'];
        }
        const sourceText = collectForm.source === 'amazon' ? 'Amazon.com' : '1688';
        const details = [
          `采集来源：${sourceText}`,
          `过滤条件：最高价格、评分、优先词、排除词和安全模式会影响最终采集数量。`,
        ];
        return details;
      }

      function productConfirmationDetails() {
        const details = [
          `处理模式：${productForm.processingMode === 'precise' ? '精细模式，会消耗 token' : '快速模式'}`,
          `来源价格加价：${Number(productForm.sourcePriceExtraCny || 0).toFixed(2)} 元`,
          `SKU 重量额外加重：${Number(productForm.weightPaddingGrams || 0)} g`,
          `买一送一规格：${productForm.buyOneTakeOne ? '添加' : '不添加'}`,
          `发布开关：${productForm.publish ? '发布' : '不发布'}`,
        ];
        if (productForm.runFlashAfterEdit) {
          details.push(`编辑完成后继续处理 ${flashSelectionText(productForm.productFlashSelectionMode, productForm.flashCount)}。`);
        }
        return details;
      }

      function flashConfirmationDetails() {
        return [
          `处理范围：${flashSelectionText(flashForm.flashSelectionMode, flashForm.flashCount)}`,
          '执行过程中会打开妙手秒杀活动并设置商品折扣。',
        ];
      }

      async function requestJson(url, options) {
        const response = await fetch(url, options);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || '请求失败。');
        }
        return payload;
      }

      async function loadAccounts() {
        const payload = await requestJson('/api/accounts');
        accounts.value = Array.isArray(payload.accounts) ? payload.accounts : [];
      }

      function emptyMiaoshouAccount() {
        return {
          id: '',
          label: '',
          loginPhone: '',
          loginPassword: '',
          appId: '',
          appSecret: '',
        };
      }

      function normalizeConfigAccounts(config) {
        const rows = config && Array.isArray(config.miaoshouAccounts) ? config.miaoshouAccounts : [];
        const nextRows = rows.map((account) => ({
          id: account.id || '',
          label: account.label || '',
          loginPhone: account.loginPhone || '',
          loginPassword: account.loginPassword || '',
          appId: account.appId || '',
          appSecret: account.appSecret || '',
          hasLoginPhone: Boolean(account.hasLoginPhone),
          hasLoginPassword: Boolean(account.hasLoginPassword),
          hasAppId: Boolean(account.hasAppId),
          hasAppSecret: Boolean(account.hasAppSecret),
        }));
        return nextRows.length > 0 ? nextRows : [emptyMiaoshouAccount()];
      }

      function markConfigFieldTouched() {
        configDirty.value = true;
      }

      function markConfigAccountsTouched() {
        configDirty.value = true;
        configAccountsTouched.value = true;
      }

      function addConfigAccount() {
        miaoshouAccountForm.value.push(emptyMiaoshouAccount());
        selectedConfigAccountIndex.value = miaoshouAccountForm.value.length - 1;
        markConfigAccountsTouched();
      }

      function removeConfigAccount(index) {
        if (miaoshouAccountForm.value.length <= 1) {
          miaoshouAccountForm.value = [emptyMiaoshouAccount()];
          selectedConfigAccountIndex.value = 0;
          markConfigAccountsTouched();
          return;
        }
        miaoshouAccountForm.value.splice(index, 1);
        selectedConfigAccountIndex.value = Math.max(
          0,
          Math.min(selectedConfigAccountIndex.value, miaoshouAccountForm.value.length - 1),
        );
        markConfigAccountsTouched();
      }

      function applyConfigPayload(config) {
        configStatus.value = config && typeof config === 'object' ? config : { sections: [], envPath: '' };
        for (const section of configSections.value) {
          for (const field of configSectionFields(section)) {
            configForm[field.key] = useLocalEnv.value ? (field.value || '') : '';
          }
        }
        miaoshouAccountForm.value = normalizeConfigAccounts(configStatus.value);
        selectedConfigAccountIndex.value = Math.max(
          0,
          Math.min(
            Number(configStatus.value.selectedMiaoshouAccountIndex || 0),
            miaoshouAccountForm.value.length - 1,
          ),
        );
        configDirty.value = false;
        configAccountsTouched.value = false;
      }

      async function loadConfig() {
        const payload = await requestJson(`/api/config?useLocalEnv=${useLocalEnv.value ? '1' : '0'}`);
        applyConfigPayload(payload.config);
      }

      async function onUseLocalEnvChange(checked) {
        useLocalEnv.value = Boolean(checked);
        await loadConfig();
      }

      async function fetchStatus() {
        try {
          const payload = await requestJson('/api/status');
          serverCapabilities.value = payload.capabilities && typeof payload.capabilities === 'object'
            ? payload.capabilities
            : { collectSources: ['1688'], amazonCollection: false };
          currentRun.value = payload.currentRun || null;
          history.value = Array.isArray(payload.history) ? payload.history : [];
          queue.value = Array.isArray(payload.queue) ? payload.queue : [];
          queuePaused.value = Boolean(payload.queuePaused);
          dashboardStats.value = payload.stats && typeof payload.stats === 'object'
            ? payload.stats
            : { totalRuns: 0, successRateText: '0%', averageDurationText: '0秒', failureRanking: [] };
          if (!currentRun.value || !currentRun.value.captcha || currentRun.value.captcha.status !== 'waiting') {
            captchaCode.value = '';
          }
        } catch (error) {
          notify('error', normalizeApiError(error));
        }
      }

      function productPayload() {
        const count = Math.max(1, Number(productForm.count || 1));
        const start = Math.max(1, Number(productForm.itemStartIndex || 1));
        return {
          tasks: {
            edit: true,
            flash: Boolean(productForm.runFlashAfterEdit),
          },
          itemSelectionMode: productForm.itemSelectionMode,
          itemStartIndex: productForm.itemSelectionMode === 'all' ? 0 : start,
          itemEndIndex: productForm.itemSelectionMode === 'all' ? 0 : start + count - 1,
          count,
          publish: Boolean(productForm.publish),
          confirmPublish: Boolean(productForm.publish),
          processingMode: productForm.processingMode,
          sourcePriceExtraCny: Number(productForm.sourcePriceExtraCny || 0),
          weightPaddingGrams: Number(productForm.weightPaddingGrams || 0),
          buyOneTakeOne: Boolean(productForm.buyOneTakeOne),
          flashSelectionMode: productForm.productFlashSelectionMode,
          flashCount: Math.max(1, Number(productForm.flashCount || 1)),
        };
      }

      function collectPayload() {
        const collectCount = collectForm.mode === 'links' ? Math.max(1, collectLinkList.value.length) : Math.max(1, Number(collectForm.count || 1));
        return {
          tasks: {
            collect: true,
            edit: false,
            flash: false,
          },
          collectSource: collectForm.mode === 'links' ? 'links' : collectForm.source,
          collectShopeeSite: 'my',
          collectShopeeMaxPrice: 10000,
          collectShopeeMaxMoq: 3,
          collectAmazonMode: collectForm.mode === 'links' ? 'links' : (collectForm.source === 'amazon' ? 'keyword' : ''),
          collectAmazonMarketplace: 'us',
          collectAmazonMaxPriceUsd: Number(collectForm.amazonMaxPriceUsd || 0),
          collectAmazonMinRating: Math.max(0, Number(collectForm.amazonMinRating || 0)),
          collectAmazonMinReviewCount: Math.max(0, Number(collectForm.amazonMinReviewCount || 0)),
          collectKeywords: collectForm.mode === 'auto' ? collectForm.keywords : '',
          collectLinks: collectForm.mode === 'links' ? collectForm.links : '',
          collectCount,
          collectDedupeWindowDays: Math.max(1, Number(collectForm.dedupeWindowDays || 7)),
          collectMaxPriceCny: collectForm.mode === 'auto' ? Number(collectForm.maxPriceCny || 0) : 10000,
          collectPreferredTerms: collectForm.mode === 'auto' ? collectForm.preferredTerms : '',
          collectExcludedTerms: collectForm.mode === 'auto' ? collectForm.excludedTerms : '',
          collectMinScore: collectForm.mode === 'auto' ? Math.max(0, Number(collectForm.minScore || 0)) : 0,
          collectSafeMode: collectForm.mode === 'auto' ? Boolean(collectForm.safeMode) : false,
          collectSkipFilters: collectForm.mode === 'links',
        };
      }

      function flashPayload() {
        return {
          tasks: {
            edit: false,
            flash: true,
          },
          flashSelectionMode: flashForm.flashSelectionMode,
          flashCount: Math.max(1, Number(flashForm.flashCount || 1)),
        };
      }

      async function startCollectRun() {
        try {
          if (collectForm.mode === 'auto' && collectForm.source === 'amazon' && !supportsAmazonCollection.value) {
            throw new Error('当前后台服务还没有加载 Amazon 采集能力，请先重启本地工作台后再开始采集。');
          }
          if (collectForm.mode === 'auto' && !String(collectForm.keywords || '').trim()) {
            throw new Error(collectForm.source === 'amazon' ? 'Amazon 关键词采集需要先填写关键词。' : '自动采集需要先填写关键词。');
          }
          if (collectForm.mode === 'links' && collectLinkList.value.length === 0) {
            throw new Error('链接采集需要先粘贴商品链接。');
          }
          const payload = collectPayload();
          const precheck = await runPrecheck(payload);
          if (!precheck.ok) {
            throw new Error((precheck.blockers || []).join('；') || '预检未通过。');
          }
          const confirmed = await confirmTaskStart({
            title: '确认开始采集任务',
            summary: collectTaskSummary.value,
            details: [...collectConfirmationDetails(), ...formatPrecheckDetails(precheck)],
          });
          if (!confirmed) {
            return;
          }
          loading.value = true;
          await requestJson('/api/run', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          await fetchStatus();
          notify('success', '商品采集任务已开始。');
        } catch (error) {
          notify('error', normalizeApiError(error));
        } finally {
          loading.value = false;
        }
      }

      async function enqueueRun(payload, successText = '任务已加入队列。') {
        try {
          const precheck = await runPrecheck(payload);
          if (!precheck.ok) {
            throw new Error((precheck.blockers || []).join('；') || '预检未通过。');
          }
          loading.value = true;
          await requestJson('/api/run/enqueue', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          await fetchStatus();
          notify('success', successText);
        } catch (error) {
          notify('error', normalizeApiError(error));
        } finally {
          loading.value = false;
        }
      }

      async function enqueueCollectRun() {
        await enqueueRun(collectPayload(), '采集任务已加入队列。');
      }

      async function enqueueProductRun() {
        await enqueueRun(productPayload(), '商品任务已加入队列。');
      }

      async function enqueueFlashRun() {
        await enqueueRun(flashPayload(), '秒杀任务已加入队列。');
      }

      async function clearQueue() {
        loading.value = true;
        try {
          await requestJson('/api/queue/clear', { method: 'POST' });
          await fetchStatus();
          notify('success', '任务队列已清空。');
        } catch (error) {
          notify('error', normalizeApiError(error));
        } finally {
          loading.value = false;
        }
      }

      async function toggleQueuePaused() {
        if (queuePaused.value && !queueItems.value.length) {
          return;
        }
        loading.value = true;
        try {
          await requestJson('/api/queue/pause', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ paused: !queuePaused.value }),
          });
          await fetchStatus();
          notify('success', queuePaused.value ? '任务队列已暂停。' : '任务队列已继续。');
        } catch (error) {
          notify('error', normalizeApiError(error));
        } finally {
          loading.value = false;
        }
      }

      async function startQueueRun() {
        loading.value = true;
        try {
          await requestJson('/api/queue/start', { method: 'POST' });
          await fetchStatus();
          notify('success', '任务队列已开始执行。');
        } catch (error) {
          notify('error', normalizeApiError(error));
        } finally {
          loading.value = false;
        }
      }

      async function removeQueueItem(item) {
        if (!item || !item.id) {
          return;
        }
        loading.value = true;
        try {
          await requestJson('/api/queue/remove', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: item.id }),
          });
          await fetchStatus();
          notify('success', '已取消这个排队任务。');
        } catch (error) {
          notify('error', normalizeApiError(error));
        } finally {
          loading.value = false;
        }
      }

      async function moveQueueItem(item, direction) {
        if (!item || !item.id) {
          return;
        }
        loading.value = true;
        try {
          await requestJson('/api/queue/move', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: item.id, direction }),
          });
          await fetchStatus();
          notify('success', '已调整排队顺序。');
        } catch (error) {
          notify('error', normalizeApiError(error));
        } finally {
          loading.value = false;
        }
      }

      async function startProductRun() {
        try {
          const payload = productPayload();
          const precheck = await runPrecheck(payload);
          if (!precheck.ok) {
            throw new Error((precheck.blockers || []).join('；') || '预检未通过。');
          }
          const confirmed = await confirmTaskStart({
            title: '确认开始商品任务',
            summary: productTaskSummary.value,
            details: [...productConfirmationDetails(), ...formatPrecheckDetails(precheck)],
          });
          if (!confirmed) {
            return;
          }
          loading.value = true;
          await requestJson('/api/run', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          await fetchStatus();
          notify('success', '商品任务已开始。');
        } catch (error) {
          notify('error', normalizeApiError(error));
        } finally {
          loading.value = false;
        }
      }

      async function startFlashRun() {
        try {
          const payload = flashPayload();
          const precheck = await runPrecheck(payload);
          if (!precheck.ok) {
            throw new Error((precheck.blockers || []).join('；') || '预检未通过。');
          }
          const confirmed = await confirmTaskStart({
            title: '确认开始秒杀任务',
            summary: flashTaskSummary.value,
            details: [...flashConfirmationDetails(), ...formatPrecheckDetails(precheck)],
          });
          if (!confirmed) {
            return;
          }
          loading.value = true;
          await requestJson('/api/run', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          await fetchStatus();
          notify('success', '秒杀任务已开始。');
        } catch (error) {
          notify('error', normalizeApiError(error));
        } finally {
          loading.value = false;
        }
      }

      async function stopRun() {
        try {
          await requestJson('/api/stop', { method: 'POST' });
          await fetchStatus();
        } catch (error) {
          notify('error', normalizeApiError(error));
        }
      }

      async function submitCaptcha() {
        if (!canSubmitCaptcha.value) {
          return;
        }
        try {
          await requestJson('/api/captcha', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: displayRun.value.captcha.id,
              code: captchaCode.value.trim(),
            }),
          });
          captchaCode.value = '';
          await fetchStatus();
          notify('success', '验证码已提交。');
        } catch (error) {
          notify('error', normalizeApiError(error));
        }
      }

      async function clearLogs() {
        try {
          await requestJson('/api/logs/clear', { method: 'POST' });
          captchaCode.value = '';
          await fetchStatus();
        } catch (error) {
          notify('error', normalizeApiError(error));
        }
      }

      async function clearHistory() {
        try {
          await requestJson('/api/history/clear', { method: 'POST' });
          await fetchStatus();
        } catch (error) {
          notify('error', normalizeApiError(error));
        }
      }

      function canResumeHistoryItem(item) {
        return Boolean(item && ['error', 'stopped'].includes(item.status));
      }

      function canRetryFailedHistoryItem(item) {
        if (!item || !['error', 'stopped'].includes(item.status)) {
          return false;
        }
        const summary = item.summary || {};
        const failedItems = [
          ...(Array.isArray(summary.failedItems) ? summary.failedItems : []),
          ...(summary.edit && Array.isArray(summary.edit.failedItems) ? summary.edit.failedItems : []),
          ...(summary.flash && Array.isArray(summary.flash.failedItems) ? summary.flash.failedItems : []),
          ...(Array.isArray(summary.results) ? summary.results.filter((result) => (
            result && (result.error || Number(result.failedCount || 0) > 0 || Number(result.errorCount || 0) > 0)
          )) : []),
        ];
        return failedItems.some((entry) => entry && (
          entry.detailId || entry.activityId || entry.productId || entry.itemId || entry.url || entry.link || entry.sourceUrl || entry.productUrl
        ));
      }

      async function resumeHistoryRun(item) {
        if (!canResumeHistoryItem(item) || !item.id || isRunning.value) {
          return;
        }
        loading.value = true;
        try {
          await requestJson('/api/run/resume', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: item.id }),
          });
          await fetchStatus();
          notify('success', '恢复执行已开始。');
        } catch (error) {
          notify('error', normalizeApiError(error));
        } finally {
          loading.value = false;
        }
      }

      async function retryFailedHistoryRun(item) {
        if (!canRetryFailedHistoryItem(item) || !item.id || isRunning.value) {
          return;
        }
        loading.value = true;
        try {
          await requestJson('/api/run/retry-failed', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: item.id }),
          });
          await fetchStatus();
          notify('success', '失败项重跑已开始。');
        } catch (error) {
          notify('error', normalizeApiError(error));
        } finally {
          loading.value = false;
        }
      }

      function failureTypeText(item) {
        if (!item) {
          return '';
        }
        return item.diagnosticFailureText
          || FAILURE_TYPE_TEXT[item.diagnosticFailureType]
          || '';
      }

      function openDiagnostic(item) {
        if (!item || !item.diagnosticId) {
          notify('error', '暂无诊断包。');
          return;
        }
        window.open(`/api/diagnostics/${encodeURIComponent(item.diagnosticId)}`, '_blank', 'noopener');
      }

      function configFieldPlaceholder(field) {
        if (field && field.secret) {
          return field.placeholder || '留空则不修改';
        }
        return field && field.placeholder ? field.placeholder : '';
      }

      async function saveConfig() {
        loading.value = true;
        try {
          const payload = await requestJson('/api/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              values: { ...configForm },
              useLocalEnv: useLocalEnv.value,
              manageMiaoshouAccounts: useLocalEnv.value || configAccountsTouched.value,
              selectedMiaoshouAccountIndex: selectedConfigAccountIndex.value,
              miaoshouAccounts: miaoshouAccountForm.value,
            }),
          });
          applyConfigPayload(payload.config);
          await loadAccounts();
          notify('success', '账户配置已保存。');
          return true;
        } catch (error) {
          notify('error', normalizeApiError(error));
          return false;
        } finally {
          loading.value = false;
        }
      }

      function onLogScroll() {
        const node = logBox.value;
        if (!node) {
          return;
        }
        logPinned.value = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      }

      async function keepLogPinned() {
        await nextTick();
        if (!logPinned.value || !logBox.value) {
          return;
        }
        logBox.value.scrollTop = logBox.value.scrollHeight;
      }

      watch(() => visibleLogs.value.length, keepLogPinned);
      watch(currentPage, updateDocumentTitle, { immediate: true });
      watch(themeName, applyTheme);

      onMounted(async () => {
        applyTheme();
        await loadAccounts();
        await loadConfig();
        await fetchStatus();
        statusTimer.value = window.setInterval(fetchStatus, 1000);
      });

      onBeforeUnmount(() => {
        if (statusTimer.value) {
          window.clearInterval(statusTimer.value);
        }
      });

      return {
        THEME_OPTIONS,
        STATUS_TEXT,
        accounts,
        addConfigAccount,
        aiUsageItems,
        antTheme,
        buildTaskText,
        canResumeHistoryItem,
        canRetryFailedHistoryItem,
        canSubmitCaptcha,
        captchaCode,
        clearHistory,
        clearLogs,
        clearQueue,
        collectForm,
        collectLinkList,
        collectAlertMessage,
        collectAlertDescription,
        collectHistoryItems,
        collectProgress,
        collectTaskSummary,
        configFieldPlaceholder,
        configAccountOptions,
        configAccountsTouched,
        configActiveTab,
        configDirty,
        configForm,
        configSections,
        configStatus,
        configRenderableGroups,
        configSectionFields,
        currentPage,
        currentRun,
        dashboardStats,
        defaultAccount,
        displayRun,
        failedCount,
        failureTypeText,
        failureRanking,
        flashProcessedActivitiesText,
        flashForm,
        flashProgress,
        flashTaskSummary,
        formatCollectPrice,
        formatCollectWeight,
        formatDate,
        formatDuration,
        formatTime,
        goPage,
        hasHistory,
        hasVisibleHistory,
        hasLogs,
        homeDisplayRun,
        homeFailureCount,
        homeProgressPercent,
        homeRecentItems,
        homeRunMetrics,
        homeRunPage,
        homeRunProgress,
        homeRunStatusText,
        homeRunSubtitle,
        homeRunTitle,
        homeUsefulLogs,
        history,
        historyStatusFilter,
        historyStatusFilterOptions,
        filteredVisibleHistory,
        isPageRunning,
        isRunning,
        loading,
        logBox,
        logClass,
        logEmptyText,
        logViewMode,
        logViewOptions,
        markConfigAccountsTouched,
        markConfigFieldTouched,
        maskPhoneText,
        miaoshouAccountForm,
        navigateToPage,
        numberText,
        onUseLocalEnvChange,
        onLogScroll,
        openDiagnostic,
        pageSubtitle,
        pageTitle,
        pageLogs,
        productForm,
        productEditPreviewItems,
        productRangeEnd,
        productProgress,
        productTaskSummary,
        progressPercent,
        activeQueueItem,
        queue,
        queueCountText,
        queueDisplayItems,
        queueItems,
        queuePaused,
        queueStatusText,
        moveQueueItem,
        removeQueueItem,
        runProgress,
        runMetrics,
        runSummary,
        removeConfigAccount,
        resumeHistoryRun,
        retryFailedHistoryRun,
        selectedConfigAccountIndex,
        saveConfig,
        enqueueCollectRun,
        enqueueProductRun,
        enqueueFlashRun,
        startCollectRun,
        startFlashRun,
        startQueueRun,
        startProductRun,
        statusColor,
        stopRun,
        submitCaptcha,
        successfulCount,
        supportsAmazonCollection,
        switchPage,
        themeName,
        toggleQueuePaused,
        useLocalEnv,
        visibleLogs,
        visibleHistory,
      };
    },
    template: `
      <a-config-provider :theme="antTheme">
        <a-layout class="app-shell">
          <div class="dashboard-frame">
            <a-layout-header class="top-nav">
              <div class="brand-block top-brand">
                <div class="brand-copy">
                  <img class="brand-logo" src="/assets/tiktok-shop-logo.png" alt="TikTok Shop">
                  <p class="brand-subtitle">妙手自动化工作台</p>
                </div>
              </div>
              <a-menu :selected-keys="[currentPage]" mode="horizontal" class="top-menu" @click="goPage">
                <a-menu-item key="home">首页</a-menu-item>
                <a-menu-item key="collect">商品采集</a-menu-item>
                <a-menu-item key="products">编辑商品</a-menu-item>
                <a-menu-item key="flash">秒杀管理</a-menu-item>
                <a-menu-item key="config">账户配置</a-menu-item>
              </a-menu>
              <div class="top-actions">
                <a-select
                  v-model:value="themeName"
                  :options="THEME_OPTIONS"
                  class="theme-select"
                  aria-label="主题"
                />
                <a-tag :color="statusColor(currentRun && currentRun.status)">
                  {{ currentRun ? STATUS_TEXT[currentRun.status] || currentRun.status : '空闲' }}
                </a-tag>
              </div>
            </a-layout-header>

            <a-layout class="main-layout">
              <a-layout-content class="content-shell">
                <section v-if="currentPage !== 'home'" class="page-hero">
                  <div>
                    <div class="eyebrow">当前页面</div>
                    <div class="page-title">{{ pageTitle }}</div>
                    <p>{{ pageSubtitle }}</p>
                  </div>
                  <div class="hero-actions">
                    <a-button
                      v-if="currentPage === 'collect'"
                      type="primary"
                      size="large"
                      :loading="loading"
                      :disabled="isRunning"
                      @click="startCollectRun"
                    >开始采集任务</a-button>
                    <a-button
                      v-if="currentPage === 'collect'"
                      size="large"
                      :loading="loading"
                      @click="enqueueCollectRun"
                    >加入队列</a-button>
                    <a-button
                      v-if="currentPage === 'products'"
                      type="primary"
                      size="large"
                      :loading="loading"
                      :disabled="isRunning"
                      @click="startProductRun"
                    >开始商品任务</a-button>
                    <a-button
                      v-if="currentPage === 'products'"
                      size="large"
                      :loading="loading"
                      @click="enqueueProductRun"
                    >加入队列</a-button>
                    <a-button
                      v-if="currentPage === 'flash'"
                      type="primary"
                      size="large"
                      :loading="loading"
                      :disabled="isRunning"
                      @click="startFlashRun"
                    >开始秒杀任务</a-button>
                    <a-button
                      v-if="currentPage === 'flash'"
                      size="large"
                      :loading="loading"
                      @click="enqueueFlashRun"
                    >加入队列</a-button>
                    <a-button v-if="currentPage !== 'home' && currentPage !== 'config'" size="large" :disabled="!isPageRunning" @click="stopRun">停止</a-button>
                  </div>
                </section>

              <section v-if="currentPage === 'home'" class="home-workbench">
                <div class="home-status-grid">
                  <a-card title="当前运行" class="soft-card home-current-card">
                    <template #extra>
                      <a-tag :color="homeDisplayRun ? statusColor(homeDisplayRun.status) : 'default'">{{ homeRunStatusText }}</a-tag>
                    </template>
                    <div class="home-current-head">
                      <div>
                        <div class="eyebrow">任务状态</div>
                        <h2>{{ homeRunTitle }}</h2>
                        <p>{{ homeRunSubtitle }}</p>
                      </div>
                      <div class="home-current-actions">
                        <a-button type="primary" :disabled="!homeDisplayRun" @click="navigateToPage(homeRunPage)">查看运行状态</a-button>
                        <a-button :disabled="!isRunning" @click="stopRun">停止</a-button>
                      </div>
                    </div>
                    <div class="home-metrics-grid">
                      <div class="home-metric-item">
                        <span>总数</span>
                        <strong>{{ homeRunMetrics.totalCount }}</strong>
                      </div>
                      <div class="home-metric-item">
                        <span>成功</span>
                        <strong>{{ homeRunMetrics.successCount }}</strong>
                      </div>
                      <div class="home-metric-item">
                        <span>失败</span>
                        <strong>{{ homeRunMetrics.failureCount }}</strong>
                      </div>
                      <div class="home-metric-item">
                        <span>用时</span>
                        <strong>{{ homeRunMetrics.durationText }}</strong>
                      </div>
                    </div>
                    <div class="home-progress-block">
                      <div class="progress-head">
                        <strong>{{ homeRunProgress ? homeRunProgress.phaseLabel : '等待开始' }}</strong>
                        <span>{{ Math.round(homeProgressPercent) }}%</span>
                      </div>
                      <a-progress :percent="homeProgressPercent" :show-info="false" />
                    </div>
                  </a-card>

                  <a-card title="今日概况" class="soft-card home-summary-card">
                    <div class="home-summary-list">
                      <div>
                        <span>总任务</span>
                        <strong>{{ dashboardStats.totalRuns || 0 }}</strong>
                      </div>
                      <div>
                        <span>成功率</span>
                        <strong>{{ dashboardStats.successRateText || '0%' }}</strong>
                      </div>
                      <div>
                        <span>平均耗时</span>
                        <strong>{{ dashboardStats.averageDurationText || '0秒' }}</strong>
                      </div>
                      <div>
                        <span>失败记录</span>
                        <strong>{{ homeFailureCount }}</strong>
                      </div>
                    </div>
                  </a-card>
                </div>

                <div class="home-quick-grid">
                  <article class="home-quick-card">
                    <div>
                      <span>商品采集</span>
                      <strong>选品进入采集箱</strong>
                      <p>按关键词或链接采集商品。</p>
                    </div>
                    <a-button type="primary" @click="navigateToPage('collect')">进入配置</a-button>
                  </article>
                  <article class="home-quick-card">
                    <div>
                      <span>编辑商品</span>
                      <strong>优化采集箱商品</strong>
                      <p>处理标题、价格、重量和发布。</p>
                    </div>
                    <a-button type="primary" @click="navigateToPage('products')">进入配置</a-button>
                  </article>
                  <article class="home-quick-card">
                    <div>
                      <span>秒杀管理</span>
                      <strong>处理活动商品</strong>
                      <p>继续处理未完成的秒杀活动。</p>
                    </div>
                    <a-button type="primary" @click="navigateToPage('flash')">进入配置</a-button>
                  </article>
                </div>

                <div class="home-main-grid">
                  <a-card title="最近记录" class="soft-card home-record-card">
                    <template #extra>
                      <a-button size="small" :disabled="!hasVisibleHistory" @click="clearHistory">清理记录</a-button>
                    </template>
                    <div class="history-filter-row">
                      <span>记录筛选</span>
                      <a-radio-group v-model:value="historyStatusFilter" button-style="solid" size="small" class="medium-radio-group">
                        <a-radio-button v-for="option in historyStatusFilterOptions" :key="option.value" :value="option.value">{{ option.label }}</a-radio-button>
                      </a-radio-group>
                    </div>
                    <a-list :data-source="homeRecentItems" :locale="{ emptyText: '暂无记录' }" class="home-record-list">
                      <template #renderItem="{ item }">
                        <a-list-item>
                          <a-list-item-meta>
                            <template #title>
                              <a-space>
                                <a-tag :color="statusColor(item.status)">{{ STATUS_TEXT[item.status] || item.status }}</a-tag>
                                <span>{{ buildTaskText(item) }}</span>
                              </a-space>
                            </template>
                            <template #description>
                              <span>{{ item.account ? maskPhoneText(item.account.label) : '-' }}</span>
                              <span class="history-dot">·</span>
                              <span>{{ formatDate(item.startedAt) }}</span>
                              <span v-if="failureTypeText(item)" class="history-dot">·</span>
                              <a-tag v-if="failureTypeText(item)" color="warning">{{ failureTypeText(item) }}</a-tag>
                              <div v-if="flashProcessedActivitiesText(item)" class="history-subline">{{ flashProcessedActivitiesText(item) }}</div>
                              <div class="history-actions">
                                <a-button
                                  v-if="canRetryFailedHistoryItem(item)"
                                  type="link"
                                  size="small"
                                  :disabled="isRunning"
                                  @click="retryFailedHistoryRun(item)"
                                >重跑失败项</a-button>
                                <a-button
                                  v-if="canResumeHistoryItem(item)"
                                  type="link"
                                  size="small"
                                  :disabled="isRunning"
                                  @click="resumeHistoryRun(item)"
                                >继续</a-button>
                                <a-button
                                  v-if="item.diagnosticId"
                                  type="link"
                                  size="small"
                                  @click="openDiagnostic(item)"
                                >诊断</a-button>
                              </div>
                            </template>
                          </a-list-item-meta>
                        </a-list-item>
                      </template>
                    </a-list>
                  </a-card>

                  <div class="home-side-stack">
                    <a-card title="任务队列" class="soft-card home-queue-card">
                      <template #extra>
                        <a-space size="small">
                          <a-button size="small" type="primary" :disabled="loading || !queueItems.length" @click="startQueueRun">开始队列</a-button>
                          <a-button size="small" :disabled="loading || (queuePaused && !queueItems.length)" @click="toggleQueuePaused">{{ queuePaused ? '继续队列' : '暂停队列' }}</a-button>
                          <a-button size="small" :disabled="!queueItems.length" @click="clearQueue">清空队列</a-button>
                        </a-space>
                      </template>
                      <div class="queue-summary">
                        <div>
                          <span>队列状态</span>
                          <strong>{{ queueStatusText }}</strong>
                        </div>
                        <div>
                          <span>待执行</span>
                          <strong>{{ queueCountText }}</strong>
                        </div>
                      </div>
                      <p class="queue-card-tip">{{ queuePaused ? '待执行任务会保留，点击开始队列后再执行。' : '队列正在按顺序执行，刷新页面后仍会保留剩余任务。' }}</p>
                      <a-list :data-source="queueDisplayItems" :locale="{ emptyText: '暂无排队任务' }" size="small">
                        <template #renderItem="{ item }">
                          <a-list-item :class="{ 'queue-running-item': item.status === 'running' }">
                            <a-list-item-meta>
                              <template #title>
                                <span>{{ item.position }}. {{ item.label }}</span>
                              </template>
                              <template #description>
                                <span>{{ item.status === 'running' ? '正在执行' : '等待执行' }}</span>
                                <span class="history-dot">·</span>
                                <span>{{ formatDate(item.createdAt) }}</span>
                                <template v-if="item.account && item.account.label">
                                  <span class="history-dot">·</span>
                                  <span>账号：{{ item.account.label }}</span>
                                </template>
                                <template v-if="item.status !== 'running'">
                                  <span class="history-dot">·</span>
                                  <a-button type="link" size="small" :disabled="loading || item.position <= (activeQueueItem ? 2 : 1)" @click="moveQueueItem(item, 'up')">上移</a-button>
                                  <a-button type="link" size="small" :disabled="loading || item.position >= queueDisplayItems.length" @click="moveQueueItem(item, 'down')">下移</a-button>
                                  <a-button type="link" size="small" :disabled="loading" @click="removeQueueItem(item)">取消</a-button>
                                </template>
                              </template>
                            </a-list-item-meta>
                          </a-list-item>
                        </template>
                      </a-list>
                    </a-card>

                    <a-card title="关键日志" class="soft-card home-log-card">
                      <div class="home-log-list">
                        <template v-if="homeUsefulLogs.length">
                          <div v-for="(entry, index) in homeUsefulLogs" :key="index" :class="logClass(entry)">
                            <span class="log-time">[{{ formatTime(entry.time) }}]</span>
                            <span>{{ maskPhoneText(entry.text) }}</span>
                          </div>
                        </template>
                        <div v-else class="empty-log">暂无关键日志</div>
                      </div>
                    </a-card>
                  </div>
                </div>
              </section>

              <section v-if="currentPage !== 'home'" class="work-grid">
                <a-card v-if="currentPage === 'collect'" title="商品采集" class="soft-card task-card collect-panel">
                  <a-alert
                    type="info"
                    show-icon
                    :message="collectAlertMessage"
                    :description="collectAlertDescription"
                  />
                  <a-form layout="vertical" class="task-form">
                    <a-form-item label="采集模式" class="form-section form-section-choice">
                      <a-radio-group v-model:value="collectForm.mode" button-style="solid" class="medium-radio-group equal-radio-group">
                        <a-radio-button value="auto">自动采集</a-radio-button>
                        <a-radio-button value="links">链接采集</a-radio-button>
                      </a-radio-group>
                    </a-form-item>
                    <a-form-item label="采集来源" class="form-section form-section-choice" v-if="collectForm.mode === 'auto'">
                      <a-radio-group v-model:value="collectForm.source" button-style="solid" class="medium-radio-group equal-radio-group">
                        <a-radio-button value="1688">1688</a-radio-button>
                        <a-radio-button value="amazon" :disabled="!supportsAmazonCollection">Amazon.com</a-radio-button>
                      </a-radio-group>
                    </a-form-item>
                    <a-form-item v-if="collectForm.mode === 'auto'" label="关键词" class="form-section">
                      <a-textarea
                        v-model:value="collectForm.keywords"
                        :rows="2"
                        :placeholder="collectForm.source === 'amazon' ? 'phone stand, collagen cream, travel organizer' : '防晒帽, 防晒冰袖, 防晒面罩'"
                      />
                    </a-form-item>
                    <a-form-item
                      v-if="collectForm.mode === 'links'"
                      label="商品链接"
                      class="form-section"
                      :extra="'每行一个商品链接；当前识别到 ' + collectLinkList.length + ' 个有效链接。'"
                    >
                      <a-textarea
                        v-model:value="collectForm.links"
                        :rows="3"
                        placeholder="https://detail.1688.com/offer/923280275684.html&#10;https://www.amazon.com/dp/B08N5WRWNW"
                      />
                    </a-form-item>
                    <div v-if="collectForm.mode === 'auto'" class="collect-auto-filter-panel">
                      <a-row :gutter="16" class="form-section form-section-pricing">
                        <a-col :xs="24" :sm="6">
                          <a-form-item label="采集数量">
                            <a-input-number v-model:value="collectForm.count" :min="1" :max="100" size="middle" class="full-width" />
                          </a-form-item>
                        </a-col>
                        <a-col v-if="collectForm.source !== 'amazon'" :xs="24" :sm="6">
                          <a-form-item label="最高采购价">
                            <a-input-number v-model:value="collectForm.maxPriceCny" :min="0.01" :max="10000" :precision="2" addon-after="元" size="middle" class="full-width" />
                          </a-form-item>
                        </a-col>
                        <a-col v-if="collectForm.source === 'amazon'" :xs="24" :sm="6">
                          <a-form-item label="最高展示价">
                            <a-input-number v-model:value="collectForm.amazonMaxPriceUsd" :min="0.01" :max="10000" :precision="2" addon-after="USD" size="middle" class="full-width" />
                          </a-form-item>
                        </a-col>
                        <a-col v-if="collectForm.source !== 'amazon'" :xs="24" :sm="6">
                          <a-form-item label="最低评分">
                            <a-input-number v-model:value="collectForm.minScore" :min="0" :max="100" size="middle" class="full-width" />
                          </a-form-item>
                        </a-col>
                        <a-col v-if="collectForm.source === 'amazon'" :xs="24" :sm="6">
                          <a-form-item label="最低评分">
                            <a-input-number v-model:value="collectForm.amazonMinRating" :min="0" :max="5" :precision="1" size="middle" class="full-width" />
                          </a-form-item>
                        </a-col>
                        <a-col :xs="24" :sm="6">
                          <a-form-item label="去重天数">
                            <a-input-number v-model:value="collectForm.dedupeWindowDays" :min="1" :max="365" addon-after="天" size="middle" class="full-width" />
                          </a-form-item>
                        </a-col>
                      </a-row>
                      <a-row :gutter="16" class="form-section">
                        <a-col v-if="collectForm.source === 'amazon'" :xs="24" :md="12">
                          <a-form-item label="最低评论数">
                            <a-input-number v-model:value="collectForm.amazonMinReviewCount" :min="0" :max="1000000" size="middle" class="full-width" />
                          </a-form-item>
                        </a-col>
                        <a-col v-if="collectForm.source !== 'amazon'" :xs="24" :md="12">
                          <a-form-item label="优先采集词">
                            <a-textarea v-model:value="collectForm.preferredTerms" :rows="3" placeholder="防晒帽, 冰袖, 面罩, 遮阳伞" />
                          </a-form-item>
                        </a-col>
                        <a-col :xs="24" :md="12">
                          <a-form-item label="排除词">
                            <a-textarea
                              v-model:value="collectForm.excludedTerms"
                              :rows="3"
                              :placeholder="collectForm.source === 'amazon' ? 'sponsored, renewed, used' : '防晒霜, 防晒喷雾, 美白, 大牌同款'"
                            />
                          </a-form-item>
                        </a-col>
                      </a-row>
                      <a-form-item
                        v-if="collectForm.source !== 'amazon'"
                        label="安全模式"
                        class="form-section form-section-switches"
                        extra="安全模式会强制拦截防晒霜/喷雾/乳液、功效宣称、仿牌等高风险商品。"
                      >
                        <a-switch v-model:checked="collectForm.safeMode" checked-children="开启" un-checked-children="关闭" />
                      </a-form-item>
                    </div>
                    <div class="summary-box form-section form-section-summary">
                      <strong>任务概况</strong>
                      <p>{{ collectTaskSummary }}</p>
                    </div>
                  </a-form>
                </a-card>

                <a-card v-if="currentPage === 'products'" title="编辑商品" class="soft-card task-card product-panel">
                  <a-alert
                    type="info"
                    show-icon
                    message="编辑发布商品"
                    description="优化商品内容，可选择是否发布；快速模式使用本地规则审核图片，精细模式使用 MiMo，可以稳定删除不符合要求的图片，但是会消耗token。"
                  />
                  <a-form layout="vertical" class="task-form">
                    <a-form-item label="处理模式" class="form-section form-section-mode">
                      <a-radio-group v-model:value="productForm.processingMode" button-style="solid" class="medium-radio-group equal-radio-group">
                        <a-radio-button value="fast" title="图片审核只用本地规则，速度更快">快速模式</a-radio-button>
                        <a-radio-button value="precise" title="图片审核使用 MiMo，识别更细但 token 消耗很大">精细模式</a-radio-button>
                      </a-radio-group>
                    </a-form-item>
                    <a-form-item label="商品选择" class="form-section form-section-choice">
                      <a-radio-group v-model:value="productForm.itemSelectionMode" button-style="solid" class="medium-radio-group equal-radio-group">
                        <a-radio-button value="range">按范围</a-radio-button>
                        <a-radio-button value="all">全部商品</a-radio-button>
                      </a-radio-group>
                    </a-form-item>
                    <a-row
                      :gutter="16"
                      class="form-section form-section-range"
                      :class="{ 'range-placeholder': productForm.itemSelectionMode !== 'range' }"
                      :aria-hidden="productForm.itemSelectionMode !== 'range'"
                    >
                      <a-col :xs="24" :sm="12">
                        <a-form-item label="开始序号">
                          <a-input-number v-model:value="productForm.itemStartIndex" :min="1" :max="500" size="middle" class="full-width" />
                        </a-form-item>
                      </a-col>
                      <a-col :xs="24" :sm="12">
                        <a-form-item label="商品数量">
                          <a-input-number v-model:value="productForm.count" :min="1" :max="500" size="middle" class="full-width" />
                        </a-form-item>
                      </a-col>
                    </a-row>
                    <a-row :gutter="16" class="form-section form-section-pricing">
                      <a-col :xs="24" :sm="12">
                        <a-form-item label="来源价格加价">
                          <a-input-number v-model:value="productForm.sourcePriceExtraCny" :min="0" :max="1000" :precision="2" addon-after="元" size="middle" class="full-width" />
                        </a-form-item>
                      </a-col>
                      <a-col :xs="24" :sm="12">
                        <a-form-item label="SKU 重量额外加重">
                          <a-input-number v-model:value="productForm.weightPaddingGrams" :min="0" :max="5000" :precision="1" addon-after="g" size="middle" class="full-width" />
                        </a-form-item>
                      </a-col>
                    </a-row>
                    <a-form-item label="单 SKU 增加买一送一规格" class="form-section form-section-offer">
                      <a-radio-group v-model:value="productForm.buyOneTakeOne" button-style="solid" class="medium-radio-group">
                        <a-radio-button :value="false">不添加</a-radio-button>
                        <a-radio-button :value="true">添加</a-radio-button>
                      </a-radio-group>
                    </a-form-item>
                    <a-row :gutter="16" class="form-section form-section-switches">
                      <a-col :xs="24" :sm="12">
                        <a-form-item label="发布开关">
                          <a-radio-group v-model:value="productForm.publish" button-style="solid" class="medium-radio-group equal-radio-group">
                            <a-radio-button :value="false">不发布</a-radio-button>
                            <a-radio-button :value="true">发布</a-radio-button>
                          </a-radio-group>
                        </a-form-item>
                      </a-col>
                      <a-col :xs="24" :sm="12">
                        <a-form-item label="完成后继续秒杀">
                          <a-radio-group v-model:value="productForm.runFlashAfterEdit" button-style="solid" class="medium-radio-group">
                            <a-radio-button :value="false">不执行</a-radio-button>
                            <a-radio-button :value="true">执行</a-radio-button>
                          </a-radio-group>
                        </a-form-item>
                      </a-col>
                    </a-row>
                    <div v-if="productForm.runFlashAfterEdit" class="form-section form-section-small flash-selection-row">
                      <a-form-item label="秒杀活动数量">
                        <a-radio-group v-model:value="productForm.productFlashSelectionMode" button-style="solid" class="medium-radio-group">
                          <a-radio-button value="count">指定数量</a-radio-button>
                          <a-radio-button value="all">全部活动</a-radio-button>
                        </a-radio-group>
                      </a-form-item>
                      <a-form-item
                        label="指定数量"
                        :class="{ 'flash-count-placeholder': productForm.productFlashSelectionMode !== 'count' }"
                        :aria-hidden="productForm.productFlashSelectionMode !== 'count'"
                      >
                        <a-input-number v-model:value="productForm.flashCount" :min="1" :max="100" size="middle" class="full-width" />
                      </a-form-item>
                    </div>
                    <div class="summary-box form-section product-edit-preview">
                      <strong>变更预览</strong>
                      <p v-for="item in productEditPreviewItems" :key="item">{{ item }}</p>
                    </div>
                    <div class="summary-box form-section form-section-summary">
                      <strong>任务概况</strong>
                      <p>{{ productTaskSummary }}</p>
                    </div>
                  </a-form>
                </a-card>

                <a-card v-if="currentPage === 'flash'" title="秒杀管理" class="soft-card task-card flash-panel">
                  <a-alert
                    type="info"
                    show-icon
                    message="处理秒杀活动"
                    description="独立处理进行中的秒杀活动，会按活动标题添加商品并设置折扣。"
                  />
                  <a-form layout="vertical" class="task-form">
                    <div class="form-section form-section-small flash-selection-row">
                      <a-form-item label="秒杀活动数量">
                        <a-radio-group v-model:value="flashForm.flashSelectionMode" button-style="solid" class="medium-radio-group">
                          <a-radio-button value="count">指定数量</a-radio-button>
                          <a-radio-button value="all">全部活动</a-radio-button>
                        </a-radio-group>
                      </a-form-item>
                      <a-form-item
                        label="指定数量"
                        :class="{ 'flash-count-placeholder': flashForm.flashSelectionMode !== 'count' }"
                        :aria-hidden="flashForm.flashSelectionMode !== 'count'"
                      >
                        <a-input-number v-model:value="flashForm.flashCount" :min="1" :max="100" size="middle" class="full-width" />
                      </a-form-item>
                    </div>
                    <div class="summary-box form-section form-section-summary">
                      <strong>任务概况</strong>
                      <p>{{ flashTaskSummary }}</p>
                    </div>
                  </a-form>
                </a-card>

                <a-card v-if="currentPage === 'config'" title="账户配置" class="soft-card task-card config-panel">
                  <template #extra>
                    <a-button type="primary" :loading="loading" :disabled="loading" @click="saveConfig">保存配置</a-button>
                  </template>
                  <div class="config-toolbar">
                    <div>
                      <strong>使用本地 .env</strong>
                      <span>开启后回填本地配置；关闭时表单保持空白。</span>
                    </div>
                    <a-switch v-model:checked="useLocalEnv" @change="onUseLocalEnvChange" />
                  </div>
                  <a-alert
                    type="info"
                    show-icon
                    message="安全保存"
                    description="密码、Secret 和 API Key 使用密码框显示；表单留空不会修改原值。"
                  />
                  <a-tabs v-model:active-key="configActiveTab" class="config-tabs">
                    <a-tab-pane v-for="section in configSections" :key="section.key" :tab="section.title">
                      <section class="config-section config-tab-panel">
                      <div class="config-section-head">
                        <h3>{{ section.title }}</h3>
                        <p>{{ section.description }}</p>
                      </div>
                      <div class="config-group-list">
                        <section
                          v-for="group in configRenderableGroups(section)"
                          :key="group.key"
                          :class="['config-field-group', { 'config-field-group-plain': group.plain }]"
                        >
                          <div v-if="!group.plain" class="config-field-group-head">
                            <h4>{{ group.title }}</h4>
                            <p v-if="group.description">{{ group.description }}</p>
                          </div>
                          <a-form layout="vertical" class="config-form">
                            <a-form-item v-for="field in group.fields" :key="field.key">
                              <template #label>
                                <span class="config-field-label">
                                  <span>{{ field.label }}</span>
                                  <a-tag class="config-field-status" :color="field.hasValue ? 'success' : 'default'">
                                    {{ field.hasValue ? '已配置' : '未配置' }}
                                  </a-tag>
                                </span>
                              </template>
                              <a-select
                                v-if="field.type === 'select'"
                                v-model:value="configForm[field.key]"
                                :options="field.options"
                                :placeholder="configFieldPlaceholder(field)"
                                @change="markConfigFieldTouched"
                                allow-clear
                              />
                              <a-textarea
                                v-else-if="field.type === 'textarea'"
                                v-model:value="configForm[field.key]"
                                :placeholder="configFieldPlaceholder(field)"
                                :auto-size="{ minRows: 3, maxRows: 6 }"
                                @change="markConfigFieldTouched"
                              />
                              <a-input-password
                                v-else-if="field.secret"
                                v-model:value="configForm[field.key]"
                                :placeholder="configFieldPlaceholder(field)"
                                autocomplete="new-password"
                                @change="markConfigFieldTouched"
                              />
                              <a-input
                                v-else
                                v-model:value="configForm[field.key]"
                                :placeholder="configFieldPlaceholder(field)"
                                @change="markConfigFieldTouched"
                              />
                              <p v-if="field.help" class="config-field-help">{{ field.help }}</p>
                            </a-form-item>
                          </a-form>
                        </section>
                      </div>
                      <div v-if="section.key === 'miaoshou'" class="miaoshou-accounts-panel">
                        <div class="miaoshou-accounts-head">
                          <div>
                            <h4>账号列表</h4>
                            <p>接口地址共用；不同账号可以分别配置登录信息、App ID 和 App Secret。</p>
                          </div>
                          <a-button type="primary" ghost @click="addConfigAccount">添加账号</a-button>
                        </div>
                        <a-alert
                          v-if="configDirty"
                          type="warning"
                          show-icon
                          message="配置尚未保存"
                          description="默认账号或账号信息修改后，需要点击保存配置才会用于下一次采集、编辑和秒杀。"
                          class="config-dirty-alert"
                        />
                        <a-form layout="vertical" class="config-form">
                          <a-form-item label="默认使用账号（保存后生效）">
                            <a-select
                              v-model:value="selectedConfigAccountIndex"
                              :options="configAccountOptions"
                              @change="markConfigAccountsTouched"
                            />
                          </a-form-item>
                          <div
                            v-for="(account, index) in miaoshouAccountForm"
                            :key="account.id || index"
                            class="miaoshou-account-card"
                          >
                            <div class="miaoshou-account-card-head">
                              <strong>账号 {{ index + 1 }}</strong>
                              <a-space>
                                <a-radio
                                  :checked="selectedConfigAccountIndex === index"
                                  @change="selectedConfigAccountIndex = index; markConfigAccountsTouched()"
                                >
                                  默认
                                </a-radio>
                                <a-button danger ghost size="small" @click="removeConfigAccount(index)">删除</a-button>
                              </a-space>
                            </div>
                            <a-row :gutter="[12, 12]">
                              <a-col :xs="24" :md="12">
                                <a-form-item>
                                  <template #label>
                                    <span class="config-field-label">
                                      <span>登录手机号/账号</span>
                                      <a-tag class="config-field-status" :color="account.hasLoginPhone || account.loginPhone ? 'success' : 'default'">
                                        {{ account.hasLoginPhone || account.loginPhone ? '已配置' : '未配置' }}
                                      </a-tag>
                                    </span>
                                  </template>
                                  <a-input-password
                                    v-model:value="account.loginPhone"
                                    placeholder="妙手登录手机号或子账号"
                                    autocomplete="off"
                                    @change="markConfigAccountsTouched"
                                  />
                                </a-form-item>
                              </a-col>
                              <a-col :xs="24" :md="12">
                                <a-form-item>
                                  <template #label>
                                    <span class="config-field-label">
                                      <span>登录密码</span>
                                      <a-tag class="config-field-status" :color="account.hasLoginPassword || account.loginPassword ? 'success' : 'default'">
                                        {{ account.hasLoginPassword || account.loginPassword ? '已配置' : '未配置' }}
                                      </a-tag>
                                    </span>
                                  </template>
                                  <a-input-password
                                    v-model:value="account.loginPassword"
                                    placeholder="留空则不修改"
                                    autocomplete="new-password"
                                    @change="markConfigAccountsTouched"
                                  />
                                </a-form-item>
                              </a-col>
                              <a-col :xs="24" :md="12">
                                <a-form-item>
                                  <template #label>
                                    <span class="config-field-label">
                                      <span>App ID</span>
                                      <a-tag class="config-field-status" :color="account.hasAppId || account.appId ? 'success' : 'default'">
                                        {{ account.hasAppId || account.appId ? '已配置' : '未配置' }}
                                      </a-tag>
                                    </span>
                                  </template>
                                  <a-input-password
                                    v-model:value="account.appId"
                                    placeholder="ak_xxx"
                                    autocomplete="off"
                                    @change="markConfigAccountsTouched"
                                  />
                                </a-form-item>
                              </a-col>
                              <a-col :xs="24" :md="12">
                                <a-form-item>
                                  <template #label>
                                    <span class="config-field-label">
                                      <span>App Secret</span>
                                      <a-tag class="config-field-status" :color="account.hasAppSecret || account.appSecret ? 'success' : 'default'">
                                        {{ account.hasAppSecret || account.appSecret ? '已配置' : '未配置' }}
                                      </a-tag>
                                    </span>
                                  </template>
                                  <a-input-password
                                    v-model:value="account.appSecret"
                                    placeholder="留空则不修改"
                                    autocomplete="new-password"
                                    @change="markConfigAccountsTouched"
                                  />
                                </a-form-item>
                              </a-col>
                            </a-row>
                          </div>
                        </a-form>
                      </div>
                      <div v-if="section.key === 'ai' && aiUsageItems.length" class="ai-usage-panel">
                        <h4>AI 功能说明</h4>
                        <div v-for="item in aiUsageItems" :key="item.feature" class="ai-usage-item">
                          <div class="ai-usage-item-head">
                            <div>
                              <strong>{{ item.feature }}</strong>
                              <a-tag>{{ item.service }}</a-tag>
                            </div>
                          </div>
                          <p>{{ item.description }}</p>
                        </div>
                      </div>
                      </section>
                    </a-tab-pane>
                  </a-tabs>
                  <div class="config-actions">
                    <span>保存后会更新本机 .env；表单留空不会修改原值，并会用于下一次采集、编辑和秒杀流程。</span>
                  </div>
                </a-card>
              </section>

              <a-card v-if="currentPage !== 'home' && currentPage !== 'config'" title="运行状态" class="soft-card run-panel">
                <template #extra>
                  <a-space>
                    <a-button :disabled="!hasLogs" @click="clearLogs">清理日志</a-button>
                  </a-space>
                </template>

                <div v-if="!displayRun" class="run-idle-state">
                  <strong>等待任务开始</strong>
                  <p>设置好上方参数后点击开始按钮，运行后这里会显示当前对象、进度和日志。</p>
                </div>

                <template v-else>
                  <a-row :gutter="[16, 16]" class="metrics-row">
                    <a-col :xs="12" :md="6"><a-statistic title="总数" :value="runMetrics.totalCount" /></a-col>
                    <a-col :xs="12" :md="6"><a-statistic title="成功" :value="runMetrics.successCount" /></a-col>
                    <a-col :xs="12" :md="6"><a-statistic title="失败" :value="runMetrics.failureCount" /></a-col>
                    <a-col :xs="12" :md="6"><a-statistic title="用时" :value="runMetrics.durationText" /></a-col>
                  </a-row>

                  <a-descriptions bordered :column="{ xs: 1, sm: 1, md: 3 }" class="run-descriptions">
                    <a-descriptions-item label="当前账号">{{ displayRun.account ? maskPhoneText(displayRun.account.label) : (defaultAccount ? maskPhoneText(defaultAccount.label) : '-') }}</a-descriptions-item>
                    <a-descriptions-item label="执行内容">{{ buildTaskText(displayRun) }}</a-descriptions-item>
                    <a-descriptions-item label="开始时间">{{ formatDate(displayRun.startedAt) }}</a-descriptions-item>
                  </a-descriptions>

                  <div v-if="currentPage === 'collect'" class="module-progress-panel collect-progress-panel">
                    <div class="module-progress-item">
                      <span>采集来源</span>
                      <strong>{{ collectProgress.sourceLabel }}</strong>
                    </div>
                    <div class="module-progress-item">
                      <span>当前采集对象</span>
                      <strong :title="collectProgress.currentTarget">{{ collectProgress.currentTarget }}</strong>
                    </div>
                    <div class="module-progress-item">
                      <span>采集进度</span>
                      <strong>{{ collectProgress.currentProgress }}</strong>
                    </div>
                  </div>

                  <div v-if="currentPage === 'products'" class="module-progress-panel product-progress-panel">
                    <div class="module-progress-item product-progress-item">
                      <span>当前正在编辑</span>
                      <strong :title="productProgress.currentItem">{{ productProgress.currentItem }}</strong>
                    </div>
                    <div class="module-progress-item product-progress-item">
                      <span>当前进度</span>
                      <strong>{{ productProgress.currentProgress }}</strong>
                    </div>
                    <div class="module-progress-item product-progress-item">
                      <span>总进度</span>
                      <strong>{{ productProgress.totalProgress }}</strong>
                    </div>
                  </div>

                  <div v-if="currentPage === 'flash'" class="module-progress-panel flash-progress-panel">
                    <div class="module-progress-item">
                      <span>当前秒杀活动</span>
                      <strong :title="flashProgress.currentActivity">{{ flashProgress.currentActivity }}</strong>
                    </div>
                    <div class="module-progress-item">
                      <span>活动进度</span>
                      <strong>{{ flashProgress.activityProgress }}</strong>
                    </div>
                    <div class="module-progress-item">
                      <span>总进度</span>
                      <strong>{{ flashProgress.totalProgress }}</strong>
                    </div>
                  </div>

                  <div class="progress-block">
                    <div class="progress-head">
                      <strong>{{ runProgress ? runProgress.phaseLabel : '等待开始' }}</strong>
                      <span>{{ Math.round(progressPercent) }}%</span>
                    </div>
                    <a-progress :percent="progressPercent" :show-info="false" />
                  </div>

                  <a-alert
                    v-if="displayRun.error"
                    type="error"
                    show-icon
                    :message="displayRun.error"
                  />

                  <div v-if="displayRun.captcha && displayRun.captcha.status === 'waiting'" class="captcha-panel">
                    <a-alert type="warning" show-icon message="需要输入验证码" :description="displayRun.captcha.message || '请输入验证码后继续。'" />
                    <div class="captcha-image-wrap">
                      <img :src="displayRun.captcha.imageUrl" alt="验证码截图">
                    </div>
                    <a-space-compact class="captcha-input-row">
                      <a-input v-model:value="captchaCode" size="large" placeholder="输入验证码" @pressEnter="submitCaptcha" />
                      <a-button type="primary" size="large" :disabled="!canSubmitCaptcha" @click="submitCaptcha">提交验证码</a-button>
                    </a-space-compact>
                  </div>

                  <div class="log-filter-row">
                    <span>日志视图</span>
                    <a-radio-group v-model:value="logViewMode" button-style="solid" size="small" class="medium-radio-group">
                      <a-radio-button v-for="option in logViewOptions" :key="option.value" :value="option.value">{{ option.label }}</a-radio-button>
                    </a-radio-group>
                  </div>

                  <div ref="logBox" class="log-box" @scroll="onLogScroll">
                    <template v-if="visibleLogs.length">
                      <div v-for="(entry, index) in visibleLogs" :key="index" :class="logClass(entry)">
                        <span class="log-time">[{{ formatTime(entry.time) }}]</span>
                        <span>{{ maskPhoneText(entry.text) }}</span>
                      </div>
                    </template>
                    <div v-else class="empty-log">{{ logEmptyText }}</div>
                  </div>
                </template>
              </a-card>

              <a-card v-if="currentPage === 'collect'" title="最近采集记录" class="soft-card history-panel collection-history-panel">
                <template #extra>
                  <a-button :disabled="!hasHistory" @click="clearHistory">清理记录</a-button>
                </template>
                <a-table
                  :data-source="collectHistoryItems"
                  :pagination="{ pageSize: 8, hideOnSinglePage: true }"
                  :scroll="{ x: 640 }"
                  row-key="id"
                  size="small"
                  :locale="{ emptyText: '暂无采集记录' }"
                >
                  <a-table-column title="商品标题" key="title">
                    <template #default="{ record }">
                      <a v-if="record.url" :href="record.url" target="_blank" rel="noreferrer" class="collection-record-title">{{ record.title }}</a>
                      <span v-else class="collection-record-title">{{ record.title }}</span>
                    </template>
                  </a-table-column>
                  <a-table-column title="采购价" key="price" width="110">
                    <template #default="{ record }">{{ formatCollectPrice(record.price) }}</template>
                  </a-table-column>
                  <a-table-column title="采集时间" key="startedAt" width="190">
                    <template #default="{ record }">{{ formatDate(record.startedAt) }}</template>
                  </a-table-column>
                </a-table>
              </a-card>

              <a-card v-if="currentPage !== 'home' && currentPage !== 'config' && currentPage !== 'collect'" title="最近记录" class="soft-card history-panel">
                <template #extra>
                  <a-button :disabled="!hasVisibleHistory" @click="clearHistory">清理记录</a-button>
                </template>
                <div class="history-filter-row">
                  <span>记录筛选</span>
                  <a-radio-group v-model:value="historyStatusFilter" button-style="solid" size="small" class="medium-radio-group">
                    <a-radio-button v-for="option in historyStatusFilterOptions" :key="option.value" :value="option.value">{{ option.label }}</a-radio-button>
                  </a-radio-group>
                </div>
                <a-list :data-source="filteredVisibleHistory" :locale="{ emptyText: '暂无记录' }">
                  <template #renderItem="{ item }">
                    <a-list-item>
                      <a-list-item-meta>
                        <template #title>
                          <a-space>
                            <a-tag :color="statusColor(item.status)">{{ STATUS_TEXT[item.status] || item.status }}</a-tag>
                            <span>{{ buildTaskText(item) }}</span>
                          </a-space>
                        </template>
                        <template #description>
                          <span>{{ item.account ? maskPhoneText(item.account.label) : '-' }}</span>
                          <span class="history-dot">·</span>
                          <span>{{ formatDate(item.startedAt) }}</span>
                          <span v-if="failureTypeText(item)" class="history-dot">·</span>
                          <a-tag v-if="failureTypeText(item)" color="warning">{{ failureTypeText(item) }}</a-tag>
                          <div v-if="flashProcessedActivitiesText(item)" class="history-subline">{{ flashProcessedActivitiesText(item) }}</div>
                          <div class="history-actions">
                            <a-button
                              v-if="canRetryFailedHistoryItem(item)"
                              type="link"
                              size="small"
                              :disabled="isRunning"
                              @click="retryFailedHistoryRun(item)"
                            >重跑失败项</a-button>
                            <a-button
                              v-if="canResumeHistoryItem(item)"
                              type="link"
                              size="small"
                              :disabled="isRunning"
                              @click="resumeHistoryRun(item)"
                            >继续</a-button>
                            <a-button
                              v-if="item.diagnosticId"
                              type="link"
                              size="small"
                              @click="openDiagnostic(item)"
                            >诊断</a-button>
                          </div>
                        </template>
                      </a-list-item-meta>
                    </a-list-item>
                  </template>
                </a-list>
              </a-card>
              </a-layout-content>
            </a-layout>
          </div>
        </a-layout>
      </a-config-provider>
    `,
  });

  if (Antd) {
    app.use(Antd);
  }
  app.mount('#app');
}());
