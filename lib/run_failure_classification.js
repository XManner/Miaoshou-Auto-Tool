const FAILURE_TYPE_LABELS = {
  captcha: '验证码',
  login: '登录失效',
  network: '网络/妙手服务异常',
  selector: '页面元素找不到',
  data: '商品/活动数据异常',
  stopped: '人工停止',
  timeout: '超时',
  unknown: '未知错误',
};

function classifyFailureText(text = '', context = {}) {
  const source = String(text || '').toLowerCase();
  if (context.status === 'stopped' || /人工停止|已停止|进程已停止|sigterm|sigint/.test(source)) {
    return 'stopped';
  }
  if (/captcha|验证码|校验码/.test(source)) {
    return 'captcha';
  }
  if (/login|登录|未登录|失效|重新登录/.test(source)) {
    return 'login';
  }
  if (/network|econn|502|503|504|网关|接口|bad gateway|service unavailable|gateway timeout/.test(source)) {
    return 'network';
  }
  if (/selector|没有找到|找不到|not found|按钮|输入框|元素/.test(source)) {
    return 'selector';
  }
  if (/detailid|required|缺失|商品数据|活动数据|invalid|参数/.test(source)) {
    return 'data';
  }
  if (/timeout|超时|timed out/.test(source)) {
    return 'timeout';
  }
  return 'unknown';
}

function classifyRunFailure(run = {}) {
  const text = [
    run.error,
    run.stderr,
    Array.isArray(run.logs) ? run.logs.map((entry) => entry && entry.text).join('\n') : '',
  ].join('\n');
  return classifyFailureText(text, { status: run.status });
}

function failureTypeLabel(type = '') {
  return FAILURE_TYPE_LABELS[type] || FAILURE_TYPE_LABELS.unknown;
}

module.exports = {
  FAILURE_TYPE_LABELS,
  classifyFailureText,
  classifyRunFailure,
  failureTypeLabel,
};
