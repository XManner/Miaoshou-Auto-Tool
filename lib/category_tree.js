function getNodeName(node) {
  return node && (
    node.nameChinese
    || node.categoryNameChinese
    || node.categoryName
    || node.name
    || node.label
    || node.cnName
    || node.title
    || node.text
  );
}

function getNodeId(node) {
  return node && (
    node.cid
    || node.categoryId
    || node.id
    || node.value
  );
}

function flattenCategoryTree(node, path = [], categories = []) {
  if (!node || typeof node !== 'object') {
    return categories;
  }

  const name = getNodeName(node);
  const cid = getNodeId(node);
  const nextPath = name ? [...path, { name, cid }] : path;

  if (name && cid) {
    categories.push({
      cid,
      name,
      nameEnglish: node.name,
      nameChinese: node.nameChinese || node.categoryNameChinese,
      isLastLevel: String(node.isLastLevel || '') === '1',
      disabled: Boolean(node.disabled),
      breadcrumb: nextPath.map((item) => item.name).join(' > '),
      raw: node,
    });
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        flattenCategoryTree(child, nextPath, categories);
      }
    } else if (value && typeof value === 'object') {
      flattenCategoryTree(value, nextPath, categories);
    }
  }

  return categories;
}

function findCategory(categories, categoryName) {
  const exactMatch = categories.find((category) => (
    category.name === categoryName
    || category.nameChinese === categoryName
    || category.nameEnglish === categoryName
  ));

  if (exactMatch) {
    return exactMatch;
  }

  const candidates = categories.filter((category) => (
    String(category.name || '').includes(categoryName)
    || String(category.nameChinese || '').includes(categoryName)
    || String(category.nameEnglish || '').toLowerCase().includes(String(categoryName).toLowerCase())
    || String(category.breadcrumb || '').includes(categoryName)
  ));

  return candidates[0];
}

module.exports = {
  findCategory,
  flattenCategoryTree,
  getNodeId,
  getNodeName,
};
