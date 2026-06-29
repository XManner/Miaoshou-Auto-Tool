const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
const packageJson = require(path.join(__dirname, '..', 'package.json'));

assert.ok(
  appSource.includes("dashboard: '数据大屏'")
    && appSource.includes("const DASHBOARD_PAGE_KEY = 'dashboard'")
    && appSource.includes('<a-menu-item key="dashboard">数据大屏</a-menu-item>'),
  'Navigation should expose an independent 数据大屏 page.',
);

assert.ok(
  appSource.includes('buildCockpitOverview')
    && appSource.includes('cockpitOverview')
    && appSource.includes('cockpitModuleCards')
    && appSource.includes('cockpitFailureBars'),
  'Dashboard should aggregate local run, queue, history, module, and failure data for the cockpit.',
);

assert.ok(
  packageJson.dependencies.echarts
    && serverSource.includes('/vendor/echarts/echarts.min.js')
    && !packageJson.dependencies['globe.gl']
    && !serverSource.includes('/vendor/globe.gl/')
    && !serverSource.includes('/vendor/three-globe/')
    && serverSource.includes('<script src="/vendor/echarts/echarts.min.js"></script>'),
  'Dashboard should load local ECharts only and remove unused globe.gl vendor bundles.',
);

assert.ok(
  appSource.includes('echarts.init')
    && appSource.includes('initCockpitCharts')
    && appSource.includes('ref="cockpitFlowChart"')
    && appSource.includes('cockpit-flow-chart')
    && appSource.includes('ref="cockpitTypeChart"')
    && appSource.includes('ref="cockpitTrendChart"')
    && !appSource.includes('new Globe')
    && !appSource.includes('window.Globe')
    && !appSource.includes('cockpitGlobeHost')
    && !appSource.includes('globeImageUrl')
    && !appSource.includes('bumpImageUrl'),
  'Dashboard charts should use ECharts and should not keep the small globe implementation.',
);

assert.ok(
  /<section v-if="currentPage === DASHBOARD_PAGE_KEY" class="cockpit-screen">[\s\S]*cockpit-dashboard-stack[\s\S]*cockpit-board cockpit-board-overview[\s\S]*cockpit-board cockpit-board-exposure[\s\S]*cockpit-board cockpit-board-threats/.test(appSource),
  'Dashboard layout should follow the new reference: stacked rounded product dashboards instead of a single globe cockpit.',
);

assert.ok(
  !appSource.includes('cockpit-pill-nav')
    && !appSource.includes('<button class="active">Dashboard</button>')
    && appSource.includes('cockpit-identity-table')
    && appSource.includes('cockpitDatastoreRows')
    && appSource.includes('cockpitIdentityRows')
    && appSource.includes('Access type')
    && appSource.includes('Identity risk')
    && appSource.includes('Hygiene & inactive identities'),
  'Dashboard should remove the decorative reference pill navigation while keeping dense datastore rows and identity/task tables.',
);

assert.ok(
  !appSource.includes(`<section v-if="currentPage !== 'home'" class="page-hero">`)
    && !appSource.includes(`<section v-if="currentPage !== 'home'" class="work-grid">`),
  'Dashboard should not inherit the normal page hero/work-grid layout.',
);

assert.ok(
  styles.includes('.cockpit-screen')
    && styles.includes('.cockpit-dashboard-stack')
    && styles.includes('.cockpit-board')
    && !styles.includes('.cockpit-pill-nav')
    && styles.includes('.cockpit-identity-table')
    && styles.includes('.cockpit-flow-chart')
    && !styles.includes('.cockpit-globe-host')
    && styles.includes('.cockpit-chart')
    && styles.includes('@keyframes cockpitPanelScan')
    && styles.includes('@keyframes cockpitPulse')
    && styles.includes('@keyframes cockpitWaveFlow'),
  'Dashboard CSS should provide the high-density neon data-screen style and animations.',
);

assert.ok(
  /@media \(max-width: 1180px\)[\s\S]*\.cockpit-screen/.test(styles),
  'Dashboard should include a responsive fallback for smaller windows.',
);

console.log('dashboard cockpit UI checks passed');
