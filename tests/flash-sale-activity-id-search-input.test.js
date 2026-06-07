const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'miaoshou_flash_sale.js'), 'utf8');
const searchActivityByIdSource = source.slice(
  source.indexOf('async function searchActivityById'),
  source.indexOf('async function clickManageProductByActivity'),
);

assert.ok(
  source.includes('function findActivityIdSearchInput'),
  'Flash sale script should isolate activity-ID input discovery in a named helper.',
);

assert.ok(
  source.includes('isShopNameSearchFieldText'),
  'Activity-ID input discovery should explicitly reject shop-name search fields.',
);

assert.ok(
  !searchActivityByIdSource.includes("if (input.parentElement) pieces.push(input.parentElement.innerText || input.parentElement.textContent || '')"),
  'Activity-ID input discovery should not use a broad parentElement text blob, which can mix shop-name and activity-ID labels.',
);

assert.ok(
  !/for \(let depth = 0; current && current !== document\.body && depth < 7; depth \+= 1\)[\s\S]*current = current\.parentElement;/.test(searchActivityByIdSource),
  'Activity-ID input discovery should not climb broad ancestors and pick the first nested input.',
);

assert.ok(
  /function findActivityIdSearchInput\([^)]*\)[\s\S]*activity\s*\.\s*test\(ownText\)/.test(searchActivityByIdSource),
  'Activity-ID input discovery should prefer direct activity-ID placeholders, labels, names, and ids from the input itself.',
);

assert.ok(
  /activity\s*\.\s*test\(text\)\s*&&\s*!isShopNameSearchFieldText\(text\)/.test(searchActivityByIdSource),
  'Activity-ID input discovery should only use nearby container text when it does not look like a shop-name field.',
);

console.log('flash sale activity ID search input checks passed');
