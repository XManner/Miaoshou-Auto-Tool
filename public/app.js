(function () {
  const { createApp, ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } = Vue;
  const Antd = window.antd || window.AntDesignVue;
  const message = Antd && Antd.message ? Antd.message : null;

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
      const selection = run.itemSelectionMode === 'all'
        ? '全部商品'
        : `${run.count || 0} 个商品`;
      parts.push(`编辑优化 ${selection}${run.publish ? '并发布' : '，不发布'}`);
    }
    if (tasks.flash) {
      parts.push(run.flashSelectionMode === 'all'
        ? '处理全部秒杀活动'
        : `处理 ${run.flashCount || 0} 个秒杀活动`);
    }
    return parts.length > 0 ? parts.join('，') : '等待选择任务。';
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

  function normalizeApiError(error) {
    return maskPhoneText(error && error.message ? error.message : String(error || '请求失败'));
  }

  const app = createApp({
    setup() {
      const currentPage = ref(window.localStorage.getItem('miaoshou-active-page') || 'home');
      const themeName = ref(window.localStorage.getItem('miaoshou-theme') || 'commerce');
      const accounts = ref([]);
      const configStatus = ref({ sections: [], envPath: '' });
      const useLocalEnv = ref(true);
      const currentRun = ref(null);
      const history = ref([]);
      const statusTimer = ref(null);
      const captchaCode = ref('');
      const logBox = ref(null);
      const logPinned = ref(true);
      const loading = ref(false);

      const productForm = reactive({
        itemSelectionMode: 'range',
        itemStartIndex: 1,
        count: 1,
        publish: false,
        processingMode: 'fast',
        sourcePriceExtraCny: 0,
        weightPaddingGrams: 30,
        runFlashAfterEdit: false,
        productFlashSelectionMode: 'count',
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
        count: 10,
        maxPriceCny: 10,
        preferredTerms: '',
        excludedTerms: '',
        minScore: 50,
        safeMode: false,
      });

      const flashForm = reactive({
        flashSelectionMode: 'count',
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
          return '在 1688 筛选低风险商品，并通过妙手开放 API 采集到 TikTok 采集箱。';
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
      const visibleLogs = computed(() => pageLogs(displayRun.value, currentPage.value));
      const hasLogs = computed(() => visibleLogs.value.length > 0);
      const hasHistory = computed(() => history.value.length > 0);
      const collectHistoryItems = computed(() => collectHistoryItemsFromRuns(history.value));
      const collectLinkList = computed(() => String(collectForm.links || '')
        .split(/[\s,，、]+/)
        .map((item) => item.trim())
        .filter(Boolean));
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
        return `使用 ${account}，编辑优化 ${selection}，${publishText}${flashText}。`;
      });
      const collectTaskSummary = computed(() => {
        const account = defaultAccount.value ? maskPhoneText(defaultAccount.value.label) : '默认账号';
        const targetCount = collectForm.mode === 'links'
          ? collectLinkList.value.length
          : Math.max(1, Number(collectForm.count || 1));
        if (collectForm.mode === 'links') {
          return `使用 ${account}，链接采集 ${targetCount} 个详情链接。`;
        }
        return `使用 ${account}，自动采集 ${targetCount} 个 1688 商品，最高采购价 ${collectForm.maxPriceCny} 元，最低评分 ${collectForm.minScore}。`;
      });
      const collectAlertMessage = computed(() => {
        if (collectForm.mode === 'links') {
          return '1688 链接采集';
        }
        return '1688 自动采集';
      });
      const collectAlertDescription = computed(() => {
        if (collectForm.mode === 'links') {
          return '粘贴 1688 商品详情链接，系统会逐个打开详情页校验价格和风险词，合格后通过妙手开放 API 采集并认领到 TikTok 采集箱。';
        }
        return '按关键词在 1688 搜索选品，按价格、评分、优先词、排除词和安全模式过滤，合格后通过妙手开放 API 采集并认领到 TikTok 采集箱。';
      });
      const flashTaskSummary = computed(() => {
        const account = defaultAccount.value ? maskPhoneText(defaultAccount.value.label) : '默认账号';
        return `使用 ${account}，只处理 ${flashSelectionText(flashForm.flashSelectionMode, flashForm.flashCount)}。`;
      });

      function applyTheme() {
        document.documentElement.dataset.theme = themeName.value;
        window.localStorage.setItem('miaoshou-theme', themeName.value);
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
          for (const field of section.fields || []) {
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
          currentRun.value = payload.currentRun || null;
          history.value = Array.isArray(payload.history) ? payload.history : [];
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
          collectSource: '1688',
          collectShopeeSite: 'my',
          collectShopeeMaxPrice: 10000,
          collectShopeeMaxMoq: 3,
          collectKeywords: collectForm.mode === 'auto' ? collectForm.keywords : '',
          collectLinks: collectForm.mode === 'links' ? collectForm.links : '',
          collectCount,
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
        loading.value = true;
        try {
          if (collectForm.mode === 'auto' && !String(collectForm.keywords || '').trim()) {
            throw new Error('自动采集需要先填写关键词。');
          }
          if (collectForm.mode === 'links' && collectLinkList.value.length === 0) {
            throw new Error('链接采集需要先粘贴 1688 详情链接。');
          }
          await requestJson('/api/run', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(collectPayload()),
          });
          await fetchStatus();
          notify('success', '商品采集任务已开始。');
        } catch (error) {
          notify('error', normalizeApiError(error));
        } finally {
          loading.value = false;
        }
      }

      async function startProductRun() {
        loading.value = true;
        try {
          await requestJson('/api/run', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(productPayload()),
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
        loading.value = true;
        try {
          await requestJson('/api/run', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(flashPayload()),
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
        canSubmitCaptcha,
        captchaCode,
        clearHistory,
        clearLogs,
        collectForm,
        collectLinkList,
        collectAlertMessage,
        collectAlertDescription,
        collectHistoryItems,
        collectTaskSummary,
        configFieldPlaceholder,
        configAccountOptions,
        configAccountsTouched,
        configDirty,
        configForm,
        configSections,
        configStatus,
        currentPage,
        currentRun,
        defaultAccount,
        displayRun,
        failedCount,
        flashForm,
        flashTaskSummary,
        formatCollectPrice,
        formatCollectWeight,
        formatDate,
        formatDuration,
        formatTime,
        goPage,
        hasHistory,
        hasLogs,
        history,
        isPageRunning,
        isRunning,
        loading,
        logBox,
        logClass,
        markConfigAccountsTouched,
        markConfigFieldTouched,
        maskPhoneText,
        miaoshouAccountForm,
        navigateToPage,
        numberText,
        onUseLocalEnvChange,
        onLogScroll,
        pageSubtitle,
        pageTitle,
        pageLogs,
        productForm,
        productRangeEnd,
        productTaskSummary,
        progressPercent,
        runProgress,
        runMetrics,
        runSummary,
        removeConfigAccount,
        selectedConfigAccountIndex,
        saveConfig,
        startCollectRun,
        startFlashRun,
        startProductRun,
        statusColor,
        stopRun,
        submitCaptcha,
        successfulCount,
        switchPage,
        themeName,
        useLocalEnv,
        visibleLogs,
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
                  <p>妙手自动化工作台</p>
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
                      v-if="currentPage === 'products'"
                      type="primary"
                      size="large"
                      :loading="loading"
                      :disabled="isRunning"
                      @click="startProductRun"
                    >开始商品任务</a-button>
                    <a-button
                      v-if="currentPage === 'flash'"
                      type="primary"
                      size="large"
                      :loading="loading"
                      :disabled="isRunning"
                      @click="startFlashRun"
                    >开始秒杀任务</a-button>
                    <a-button v-if="currentPage !== 'home' && currentPage !== 'config'" size="large" :disabled="!isPageRunning" @click="stopRun">停止</a-button>
                  </div>
                </section>

              <section v-if="currentPage === 'home'" class="home-overview">
                <div class="overview-head">
                  <div>
                    <div class="eyebrow">工作台能力</div>
                    <h2>功能概览</h2>
                    <p>围绕 TikTok Shop 东南亚店铺，把 1688 选品、妙手采集、商品编辑发布和秒杀活动串成一条可执行流程。</p>
                  </div>
                  <div class="flow-strip">
                    <span>1688 选品</span>
                    <span>妙手采集箱</span>
                    <span>编辑发布</span>
                    <span>秒杀活动</span>
                  </div>
                </div>

                <div class="feature-grid">
                  <article class="feature-card">
                    <div class="feature-kicker">选品到采集箱</div>
                    <h3>采集 1688 商品</h3>
                    <p>按关键词搜索商品，支持最高采购价、优先词、排除词和安全模式过滤，合格后通过妙手开放 API 采集并认领到 TikTok 采集箱。</p>
                    <a-button type="primary" @click="navigateToPage('collect')">进入商品采集</a-button>
                  </article>
                  <article class="feature-card">
                    <div class="feature-kicker">采集箱到店铺</div>
                    <h3>优化并发布商品信息</h3>
                    <p>自动处理采集箱商品，可设置价格加价、重量加重、图片审核模式，并按需要发布到 TikTok Shop。</p>
                    <a-button @click="navigateToPage('products')">进入编辑商品</a-button>
                  </article>
                  <article class="feature-card">
                    <div class="feature-kicker">发布后促销</div>
                    <h3>自动设置限时秒杀</h3>
                    <p>处理进行中的秒杀活动，按活动标题匹配商品，自动进入管理产品、添加商品并设置折扣。</p>
                    <a-button @click="navigateToPage('flash')">进入秒杀管理</a-button>
                  </article>
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
                      <a-radio-group v-model:value="collectForm.mode" button-style="solid" class="large-radio-group">
                        <a-radio-button value="auto">自动采集</a-radio-button>
                        <a-radio-button value="links">链接采集</a-radio-button>
                      </a-radio-group>
                    </a-form-item>
                    <a-form-item v-if="collectForm.mode === 'auto'" label="关键词" class="form-section">
                      <a-textarea v-model:value="collectForm.keywords" :rows="2" placeholder="防晒帽, 防晒冰袖, 防晒面罩" />
                    </a-form-item>
                    <a-form-item
                      v-if="collectForm.mode === 'links'"
                      label="1688 详情链接"
                      class="form-section"
                      :extra="'每行一个链接；当前识别到 ' + collectLinkList.length + ' 个有效链接。'"
                    >
                      <a-textarea v-model:value="collectForm.links" :rows="3" placeholder="https://detail.1688.com/offer/923280275684.html" />
                    </a-form-item>
                    <div v-if="collectForm.mode === 'auto'" class="collect-auto-filter-panel">
                      <a-row :gutter="16" class="form-section form-section-pricing">
                        <a-col :xs="24" :sm="8">
                          <a-form-item label="采集数量">
                            <a-input-number v-model:value="collectForm.count" :min="1" :max="100" size="large" class="full-width" />
                          </a-form-item>
                        </a-col>
                        <a-col :xs="24" :sm="8">
                          <a-form-item label="最高采购价">
                            <a-input-number v-model:value="collectForm.maxPriceCny" :min="0.01" :max="10000" :precision="2" addon-after="元" size="large" class="full-width" />
                          </a-form-item>
                        </a-col>
                        <a-col :xs="24" :sm="8">
                          <a-form-item label="最低评分">
                            <a-input-number v-model:value="collectForm.minScore" :min="0" :max="100" size="large" class="full-width" />
                          </a-form-item>
                        </a-col>
                      </a-row>
                      <a-row :gutter="16" class="form-section">
                        <a-col :xs="24" :md="12">
                          <a-form-item label="优先采集词">
                            <a-textarea v-model:value="collectForm.preferredTerms" :rows="3" placeholder="防晒帽, 冰袖, 面罩, 遮阳伞" />
                          </a-form-item>
                        </a-col>
                        <a-col :xs="24" :md="12">
                          <a-form-item label="排除词">
                            <a-textarea v-model:value="collectForm.excludedTerms" :rows="3" placeholder="防晒霜, 防晒喷雾, 美白, 大牌同款" />
                          </a-form-item>
                        </a-col>
                      </a-row>
                      <a-form-item
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
                    description="优化商品内容，可选择是否发布；快速模式使用本地规则审核图片，精细模式使用 MiMo，识别更细但 token 消耗很大。"
                  />
                  <a-form layout="vertical" class="task-form">
                    <a-form-item label="商品选择" class="form-section form-section-choice">
                      <a-radio-group v-model:value="productForm.itemSelectionMode" button-style="solid" class="large-radio-group">
                        <a-radio-button value="range">按范围</a-radio-button>
                        <a-radio-button value="all">全部商品</a-radio-button>
                      </a-radio-group>
                    </a-form-item>
                    <a-row :gutter="16" v-if="productForm.itemSelectionMode === 'range'" class="form-section form-section-range">
                      <a-col :xs="24" :sm="12">
                        <a-form-item label="开始序号">
                          <a-input-number v-model:value="productForm.itemStartIndex" :min="1" :max="500" size="large" class="full-width" />
                        </a-form-item>
                      </a-col>
                      <a-col :xs="24" :sm="12">
                        <a-form-item label="商品数量">
                          <a-input-number v-model:value="productForm.count" :min="1" :max="500" size="large" class="full-width" />
                        </a-form-item>
                      </a-col>
                    </a-row>
                    <a-form-item label="处理模式" class="form-section form-section-mode">
                      <div class="mode-button-group">
                        <a-tooltip title="图片审核只用本地规则，速度更快">
                          <a-button
                            size="large"
                            :type="productForm.processingMode === 'fast' ? 'primary' : 'default'"
                            @click="productForm.processingMode = 'fast'"
                          >快速模式</a-button>
                        </a-tooltip>
                        <a-tooltip title="图片审核使用 MiMo，识别更细但 token 消耗很大">
                          <a-button
                            size="large"
                            :type="productForm.processingMode === 'precise' ? 'primary' : 'default'"
                            @click="productForm.processingMode = 'precise'"
                          >精细模式</a-button>
                        </a-tooltip>
                      </div>
                    </a-form-item>
                    <a-row :gutter="16" class="form-section form-section-pricing">
                      <a-col :xs="24" :sm="12">
                        <a-form-item label="来源价格加价">
                          <a-input-number v-model:value="productForm.sourcePriceExtraCny" :min="0" :max="1000" :precision="2" addon-after="元" size="large" class="full-width" />
                        </a-form-item>
                      </a-col>
                      <a-col :xs="24" :sm="12">
                        <a-form-item label="SKU 重量额外加重">
                          <a-input-number v-model:value="productForm.weightPaddingGrams" :min="0" :max="5000" :precision="1" addon-after="g" size="large" class="full-width" />
                        </a-form-item>
                      </a-col>
                    </a-row>
                    <a-row :gutter="16" class="form-section form-section-switches">
                      <a-col :xs="24" :sm="12">
                        <a-form-item label="发布开关">
                          <a-radio-group v-model:value="productForm.publish" button-style="solid" class="large-radio-group">
                            <a-radio-button :value="false">不发布</a-radio-button>
                            <a-radio-button :value="true">发布</a-radio-button>
                          </a-radio-group>
                        </a-form-item>
                      </a-col>
                      <a-col :xs="24" :sm="12">
                        <a-form-item label="完成后继续秒杀">
                          <a-radio-group v-model:value="productForm.runFlashAfterEdit" button-style="solid" class="large-radio-group">
                            <a-radio-button :value="false">不执行</a-radio-button>
                            <a-radio-button :value="true">执行</a-radio-button>
                          </a-radio-group>
                        </a-form-item>
                      </a-col>
                    </a-row>
                    <div v-if="productForm.runFlashAfterEdit" class="form-section form-section-small">
                      <a-form-item label="秒杀活动数量">
                        <a-radio-group v-model:value="productForm.productFlashSelectionMode" button-style="solid">
                          <a-radio-button value="count">指定数量</a-radio-button>
                          <a-radio-button value="all">全部活动</a-radio-button>
                        </a-radio-group>
                      </a-form-item>
                      <a-form-item v-if="productForm.productFlashSelectionMode === 'count'" label="指定数量">
                        <a-input-number v-model:value="productForm.flashCount" :min="1" :max="100" size="large" class="full-width" />
                      </a-form-item>
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
                    <div class="form-section form-section-small">
                      <a-form-item label="秒杀活动数量">
                        <a-radio-group v-model:value="flashForm.flashSelectionMode" button-style="solid">
                          <a-radio-button value="count">指定数量</a-radio-button>
                          <a-radio-button value="all">全部活动</a-radio-button>
                        </a-radio-group>
                      </a-form-item>
                      <a-form-item v-if="flashForm.flashSelectionMode === 'count'" label="指定数量">
                        <a-input-number v-model:value="flashForm.flashCount" :min="1" :max="100" size="large" class="full-width" />
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
                  <div class="config-grid">
                    <section v-for="section in configSections" :key="section.key" class="config-section">
                      <div class="config-section-head">
                        <h3>{{ section.title }}</h3>
                        <p>{{ section.description }}</p>
                      </div>
                      <a-form layout="vertical" class="config-form">
                        <a-form-item v-for="field in section.fields" :key="field.key">
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
                        <h4>本地服务 AI 功能使用说明</h4>
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
                  </div>
                  <div class="config-actions">
                    <span>保存后会更新本机 .env；表单留空不会修改原值，并会用于下一次采集、编辑和秒杀流程。</span>
                  </div>
                </a-card>
              </section>

              <a-card v-if="currentPage !== 'home' && currentPage !== 'config'" title="运行状态" class="soft-card run-panel">
                <template #extra>
                  <a-space>
                    <a-button :disabled="!hasLogs" @click="clearLogs">清理日志</a-button>
                    <a-button danger :disabled="!isPageRunning" @click="stopRun">停止</a-button>
                  </a-space>
                </template>

                <a-row :gutter="[16, 16]" class="metrics-row">
                  <a-col :xs="12" :md="6"><a-statistic title="总数" :value="runMetrics.totalCount" /></a-col>
                  <a-col :xs="12" :md="6"><a-statistic title="成功" :value="runMetrics.successCount" /></a-col>
                  <a-col :xs="12" :md="6"><a-statistic title="失败" :value="runMetrics.failureCount" /></a-col>
                  <a-col :xs="12" :md="6"><a-statistic title="用时" :value="runMetrics.durationText" /></a-col>
                </a-row>

                <a-descriptions bordered :column="{ xs: 1, sm: 1, md: 3 }" class="run-descriptions">
                  <a-descriptions-item label="当前账号">{{ displayRun && displayRun.account ? maskPhoneText(displayRun.account.label) : (defaultAccount ? maskPhoneText(defaultAccount.label) : '-') }}</a-descriptions-item>
                  <a-descriptions-item label="执行内容">{{ buildTaskText(displayRun) }}</a-descriptions-item>
                  <a-descriptions-item label="开始时间">{{ displayRun ? formatDate(displayRun.startedAt) : '-' }}</a-descriptions-item>
                </a-descriptions>

                <div class="progress-block">
                  <div class="progress-head">
                    <strong>{{ runProgress ? runProgress.phaseLabel : '等待开始' }}</strong>
                    <span>{{ Math.round(progressPercent) }}%</span>
                  </div>
                  <a-progress :percent="progressPercent" :show-info="false" />
                </div>

                <a-alert
                  v-if="displayRun && displayRun.error"
                  type="error"
                  show-icon
                  :message="displayRun.error"
                />

                <div v-if="displayRun && displayRun.captcha && displayRun.captcha.status === 'waiting'" class="captcha-panel">
                  <a-alert type="warning" show-icon message="需要输入验证码" :description="displayRun.captcha.message || '请输入验证码后继续。'" />
                  <div class="captcha-image-wrap">
                    <img :src="displayRun.captcha.imageUrl" alt="验证码截图">
                  </div>
                  <a-space-compact class="captcha-input-row">
                    <a-input v-model:value="captchaCode" size="large" placeholder="输入验证码" @pressEnter="submitCaptcha" />
                    <a-button type="primary" size="large" :disabled="!canSubmitCaptcha" @click="submitCaptcha">提交验证码</a-button>
                  </a-space-compact>
                </div>

                <div ref="logBox" class="log-box" @scroll="onLogScroll">
                  <template v-if="visibleLogs.length">
                    <div v-for="(entry, index) in visibleLogs" :key="index" :class="logClass(entry)">
                      <span class="log-time">[{{ formatTime(entry.time) }}]</span>
                      <span>{{ maskPhoneText(entry.text) }}</span>
                    </div>
                  </template>
                  <div v-else class="empty-log">等待执行...</div>
                </div>
              </a-card>

              <a-card v-if="currentPage === 'collect'" title="最近采集记录" class="soft-card history-panel collection-history-panel">
                <template #extra>
                  <a-button :disabled="!hasHistory" @click="clearHistory">清理记录</a-button>
                </template>
                <a-table
                  :data-source="collectHistoryItems"
                  :pagination="{ pageSize: 8, hideOnSinglePage: true }"
                  :scroll="{ x: 760 }"
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
                  <a-table-column title="重量" key="weight" width="110">
                    <template #default="{ record }">{{ record.weightText || formatCollectWeight(record.weightGrams) }}</template>
                  </a-table-column>
                  <a-table-column title="采集时间" key="startedAt" width="190">
                    <template #default="{ record }">{{ formatDate(record.startedAt) }}</template>
                  </a-table-column>
                </a-table>
              </a-card>

              <a-card v-if="currentPage !== 'config' && currentPage !== 'collect'" title="最近记录" :class="['soft-card', 'history-panel', { 'home-history-panel': currentPage === 'home' }]">
                <template #extra>
                  <a-button :disabled="!hasHistory" @click="clearHistory">清理记录</a-button>
                </template>
                <a-list :data-source="history" :locale="{ emptyText: '暂无记录' }">
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
