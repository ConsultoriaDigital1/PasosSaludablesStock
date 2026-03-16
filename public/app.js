const SESSION_TOKEN_KEY = 'stockmanager.jwt';
const MOVEMENT_COPY = {
  SALE: 'Carga varios repuestos en una sola venta y el sistema calcula el total antes de guardar.',
  OUT: 'Usalo para salidas por ajuste, garantia o consumo interno sin tocar la caja.',
  IN: 'Usalo para ingresos, reposiciones o correcciones positivas de stock.'
};

const state = {
  activeView: resolveInitialView(),
  products: [],
  categories: [],
  movements: [],
  transactions: [],
  dashboard: {
    summary: {},
    monthlyFinance: [],
    expenseBreakdown: []
  },
  stats: {
    categoryDistribution: [],
    topStock: [],
    lowStock: [],
    movementTrend: []
  },
  auth: {
    token: window.localStorage.getItem(SESSION_TOKEN_KEY) || '',
    user: null
  },
  editingId: null,
  pendingProductPayload: null,
  movementDraft: {
    nextKey: 2,
    items: [createMovementLineItem(1)]
  }
};

const nodes = {
  authShell: document.querySelector('#auth-shell'),
  appShell: document.querySelector('#app-shell'),
  loginForm: document.querySelector('#login-form'),
  loginUsername: document.querySelector('#login-username'),
  loginPassword: document.querySelector('#login-password'),
  loginError: document.querySelector('#login-error'),
  logoutButton: document.querySelector('#logout-button'),
  sessionUser: document.querySelector('#session-user'),
  viewTitle: document.querySelector('#view-title'),
  viewCopy: document.querySelector('#view-copy'),
  navLinks: [...document.querySelectorAll('[data-view-target]')],
  views: [...document.querySelectorAll('[data-view]')],
  healthLabel: document.querySelector('#health-label'),
  healthDetail: document.querySelector('#health-detail'),
  metricProducts: document.querySelector('#metric-products'),
  metricStock: document.querySelector('#metric-stock'),
  metricBalance: document.querySelector('#metric-balance'),
  dashInventoryValue: document.querySelector('#dash-inventory-value'),
  dashRecentUnits: document.querySelector('#dash-recent-units'),
  dashIncome: document.querySelector('#dash-income'),
  dashExpense: document.querySelector('#dash-expense'),
  financeChart: document.querySelector('#finance-chart'),
  expenseChart: document.querySelector('#expense-chart'),
  dashboardMovements: document.querySelector('#dashboard-movements'),
  dashboardTransactions: document.querySelector('#dashboard-transactions'),
  searchInput: document.querySelector('#search-input'),
  categoryFilter: document.querySelector('#category-filter'),
  productsTable: document.querySelector('#products-table'),
  productTemplate: document.querySelector('#product-row-template'),
  openProductModal: document.querySelector('#open-product-modal'),
  productFormModal: document.querySelector('#product-form-modal'),
  productForm: document.querySelector('#product-form'),
  formTitle: document.querySelector('#form-title'),
  productId: document.querySelector('#product-id'),
  productName: document.querySelector('#product-name'),
  productDescription: document.querySelector('#product-description'),
  productCategory: document.querySelector('#product-category'),
  productPrice: document.querySelector('#product-price'),
  productStock: document.querySelector('#product-stock'),
  productImage: document.querySelector('#product-image'),
  productFeatured: document.querySelector('#product-featured'),
  resetProduct: document.querySelector('#reset-product'),
  categoryOptions: document.querySelector('#category-options'),
  productConfirmModal: document.querySelector('#product-confirm-modal'),
  productConfirmSummary: document.querySelector('#product-confirm-summary'),
  cancelProductConfirm: document.querySelector('#cancel-product-confirm'),
  acceptProductConfirm: document.querySelector('#accept-product-confirm'),
  productModalCloseTargets: [...document.querySelectorAll('[data-close-product-modal]')],
  modalCloseTargets: [...document.querySelectorAll('[data-close-modal]')],
  movementForm: document.querySelector('#movement-form'),
  movementType: document.querySelector('#movement-type'),
  movementIntro: document.querySelector('#movement-intro'),
  movementLines: document.querySelector('#movement-lines'),
  movementLineTemplate: document.querySelector('#movement-line-template'),
  addMovementLine: document.querySelector('#add-movement-line'),
  movementDefaultQuantity: document.querySelector('#movement-default-quantity'),
  movementReason: document.querySelector('#movement-reason'),
  movementPaymentMethod: document.querySelector('#movement-payment-method'),
  movementPaymentShell: document.querySelector('#movement-payment-shell'),
  movementReference: document.querySelector('#movement-reference'),
  movementReferenceShell: document.querySelector('#movement-reference-shell'),
  movementNote: document.querySelector('#movement-note'),
  movementLog: document.querySelector('#movement-log'),
  movementLineCount: document.querySelector('#movement-line-count'),
  movementTotalQuantity: document.querySelector('#movement-total-quantity'),
  movementTotalAmount: document.querySelector('#movement-total-amount'),
  statAverageStock: document.querySelector('#stat-average-stock'),
  statCategories: document.querySelector('#stat-categories'),
  statLowStock: document.querySelector('#stat-low-stock'),
  statMovements: document.querySelector('#stat-movements'),
  categoryChart: document.querySelector('#category-chart'),
  movementChart: document.querySelector('#movement-chart'),
  topProducts: document.querySelector('#top-products'),
  lowStockList: document.querySelector('#low-stock-list'),
  treasuryBalance: document.querySelector('#treasury-balance'),
  treasuryIncome: document.querySelector('#treasury-income'),
  treasuryExpense: document.querySelector('#treasury-expense'),
  treasuryCount: document.querySelector('#treasury-count'),
  treasuryForm: document.querySelector('#treasury-form'),
  txType: document.querySelector('#tx-type'),
  txCategory: document.querySelector('#tx-category'),
  txAmount: document.querySelector('#tx-amount'),
  txMethod: document.querySelector('#tx-method'),
  txReference: document.querySelector('#tx-reference'),
  txDate: document.querySelector('#tx-date'),
  txNote: document.querySelector('#tx-note'),
  txFilterType: document.querySelector('#tx-filter-type'),
  txFilterCategory: document.querySelector('#tx-filter-category'),
  transactionsTable: document.querySelector('#transactions-table'),
  transactionRowTemplate: document.querySelector('#transaction-row-template'),
  listItemTemplate: document.querySelector('#list-item-template')
};

boot();

async function boot() {
  bindEvents();
  nodes.txDate.value = toDateTimeLocal(new Date());
  syncMovementMode();
  renderMovementBuilder();

  const hasSession = await restoreSession();

  if (!hasSession) {
    showAuthShell();
    return;
  }

  await enterApplication();
}

function bindEvents() {
  nodes.loginForm.addEventListener('submit', login);
  nodes.logoutButton.addEventListener('click', logout);
  nodes.navLinks.forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.viewTarget));
  });
  nodes.searchInput.addEventListener('input', debounce(renderProducts, 120));
  nodes.categoryFilter.addEventListener('change', renderProducts);
  nodes.openProductModal.addEventListener('click', () => {
    resetProductForm();
    openProductFormModal();
  });
  nodes.productForm.addEventListener('submit', saveProduct);
  nodes.resetProduct.addEventListener('click', resetProductForm);
  nodes.cancelProductConfirm.addEventListener('click', closeProductConfirmModal);
  nodes.acceptProductConfirm.addEventListener('click', confirmProductCreation);
  nodes.productModalCloseTargets.forEach((node) => {
    node.addEventListener('click', () => closeProductFormModal());
  });
  nodes.modalCloseTargets.forEach((node) => {
    node.addEventListener('click', closeProductConfirmModal);
  });
  nodes.movementForm.addEventListener('submit', saveMovement);
  nodes.movementType.addEventListener('change', () => {
    syncMovementMode();
    renderMovementBuilder();
  });
  nodes.addMovementLine.addEventListener('click', addMovementLine);
  nodes.treasuryForm.addEventListener('submit', saveTransaction);
  nodes.txFilterType.addEventListener('change', loadTransactions);
  nodes.txFilterCategory.addEventListener('input', debounce(loadTransactions, 220));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }

    if (nodes.productConfirmModal.classList.contains('is-open')) {
      closeProductConfirmModal();
      return;
    }

    if (nodes.productFormModal.classList.contains('is-open')) {
      closeProductFormModal();
    }
  });
}

function resolveInitialView() {
  const requestedView = new URL(window.location.href).searchParams.get('view');
  const allowedViews = ['dashboard', 'inventory', 'output', 'stats', 'treasury'];
  return allowedViews.includes(requestedView) ? requestedView : 'dashboard';
}

function switchView(viewName) {
  state.activeView = viewName;
  nodes.viewTitle.textContent = titleForView(viewName);
  nodes.viewCopy.textContent = copyForView(viewName);
  nodes.navLinks.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.viewTarget === viewName);
  });
  nodes.views.forEach((view) => {
    view.classList.toggle('is-visible', view.dataset.view === viewName);
  });
}

async function restoreSession() {
  if (!state.auth.token) {
    return false;
  }

  try {
    const response = await authorizedFetch('/api/auth/session');

    if (!response.ok) {
      clearSession();
      return false;
    }

    const data = await response.json();
    state.auth.user = data.user;
    return true;
  } catch (error) {
    clearSession();
    return false;
  }
}

async function enterApplication() {
  syncSessionUser();
  showAppShell();

  try {
    await loadAppData();
  } catch (error) {
    // request() already surfaces the relevant backend error.
  }

  switchView(state.activeView);
}

async function login(event) {
  event.preventDefault();
  setLoginError('');

  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: nodes.loginUsername.value.trim(),
      password: nodes.loginPassword.value
    })
  });

  if (!response.ok) {
    let message = 'No se pudo iniciar sesion.';

    try {
      const data = await response.json();
      message = data.error || message;
    } catch (error) {
      message = response.statusText || message;
    }

    setLoginError(message);
    return;
  }

  const data = await response.json();
  state.auth.token = data.token;
  state.auth.user = data.user;
  persistSession();
  nodes.loginForm.reset();
  await enterApplication();
}

function logout() {
  clearSession();
  showAuthShell('Sesion cerrada.');
}

function showAuthShell(message = '') {
  nodes.appShell.hidden = true;
  nodes.authShell.hidden = false;
  syncModalBodyState();
  setLoginError(message);
  window.requestAnimationFrame(() => {
    nodes.loginUsername.focus();
  });
}

function showAppShell() {
  nodes.authShell.hidden = true;
  nodes.appShell.hidden = false;
}

function setLoginError(message) {
  const hasMessage = Boolean(message);
  nodes.loginError.hidden = !hasMessage;
  nodes.loginError.textContent = message;
}

function syncSessionUser() {
  const username = state.auth.user?.username || '';
  nodes.sessionUser.hidden = !username;
  nodes.sessionUser.textContent = username ? `Sesion activa: ${username}` : '';
}

function persistSession() {
  window.localStorage.setItem(SESSION_TOKEN_KEY, state.auth.token);
}

function clearSession() {
  state.auth.token = '';
  state.auth.user = null;
  window.localStorage.removeItem(SESSION_TOKEN_KEY);
}

async function loadAppData() {
  await Promise.all([
    loadHealth(),
    loadCategories(),
    loadProducts(),
    loadMovements(),
    loadTransactions(),
    loadDashboard(),
    loadStats()
  ]);
}

async function loadHealth() {
  try {
    const data = await request('/api/health');
    nodes.healthLabel.textContent = data.ok ? 'Base conectada' : 'Base con problemas';
    nodes.healthDetail.textContent = data.ok
      ? `Conexion valida. Hora de la base: ${new Date(data.now).toLocaleString()}`
      : 'No se pudo validar la base de datos.';
  } catch (error) {
    nodes.healthLabel.textContent = 'Base con problemas';
    nodes.healthDetail.textContent = 'Fallo la conexion con el backend.';
  }
}

async function loadDashboard() {
  state.dashboard = await request('/api/dashboard');
  renderDashboard();
}

async function loadStats() {
  state.stats = await request('/api/stats');
  renderStats();
}

async function loadCategories() {
  state.categories = await request('/api/categories');
  renderCategories();
}

async function loadProducts() {
  state.products = await request('/api/products');
  renderProducts();
  renderMovementBuilder();
  syncTopMetrics();
}

async function loadMovements() {
  state.movements = await request('/api/stock-movements?limit=12');
  renderMovements();
}

async function loadTransactions() {
  const params = new URLSearchParams();
  const type = nodes.txFilterType.value.trim();
  const category = nodes.txFilterCategory.value.trim();

  if (type) {
    params.set('type', type);
  }
  if (category) {
    params.set('category', category);
  }

  const suffix = params.toString() ? `?${params.toString()}` : '';
  state.transactions = await request(`/api/treasury/transactions${suffix}`);
  renderTransactions();
}

function renderDashboard() {
  const summary = state.dashboard.summary || {};
  nodes.dashInventoryValue.textContent = money(summary.inventoryValue || 0);
  nodes.dashRecentUnits.textContent = String(summary.recentUnitsOut || 0);
  nodes.dashIncome.textContent = money(summary.totalIncome || 0);
  nodes.dashExpense.textContent = money(summary.totalExpense || 0);
  nodes.metricBalance.textContent = money(summary.treasuryBalance || 0);

  renderBarChart(nodes.financeChart, state.dashboard.monthlyFinance, [
    { key: 'income', label: 'Ingresos', className: 'bar-income' },
    { key: 'expense', label: 'Gastos', className: 'bar-expense' }
  ], 'month');

  renderStackChart(nodes.expenseChart, state.dashboard.expenseBreakdown, 'category', 'total');

  renderList(
    nodes.dashboardMovements,
    state.movements.slice(0, 6),
    (item) => ({
      title: movementTitle(item),
      subtitle: item.reason || 'Sin detalle',
      value: item.totalAmount != null && item.movementType === 'SALE'
        ? `${item.quantity} u. · ${money(item.totalAmount)}`
        : `${item.movementType === 'IN' ? '+' : '-'}${item.quantity}`,
      date: item.createdAt
    })
  );

  renderList(
    nodes.dashboardTransactions,
    state.transactions.slice(0, 6),
    (item) => ({
      title: `${transactionTypeLabel(item.transactionType)} - ${item.category}`,
      subtitle: item.note || item.paymentMethod || 'Sin detalle',
      value: money(signedAmount(item)),
      date: item.occurredAt
    })
  );

  renderTreasurySummary();
  syncTopMetrics();
}

function renderStats() {
  const totalProducts = state.products.length;
  const totalStock = state.products.reduce((sum, product) => sum + product.stockQuantity, 0);
  const totalMovements = state.stats.movementTrend.reduce(
    (sum, day) => sum + Number(day.unitsIn || 0) + Number(day.unitsOut || 0),
    0
  );

  nodes.statAverageStock.textContent = totalProducts ? (totalStock / totalProducts).toFixed(1) : '0';
  nodes.statCategories.textContent = String(state.categories.length);
  nodes.statLowStock.textContent = String(state.stats.lowStock.length);
  nodes.statMovements.textContent = String(totalMovements);

  renderBarChart(nodes.categoryChart, state.stats.categoryDistribution, [
    { key: 'units', label: 'Unidades', className: 'bar-income' }
  ], 'category');

  renderBarChart(nodes.movementChart, state.stats.movementTrend, [
    { key: 'unitsIn', label: 'Entradas', className: 'bar-income' },
    { key: 'unitsOut', label: 'Salidas', className: 'bar-expense' }
  ], 'day');

  renderList(
    nodes.topProducts,
    state.stats.topStock,
    (item) => ({
      title: item.name,
      subtitle: 'Mayor volumen en stock',
      value: `${item.stockQuantity} u.`,
      date: ''
    })
  );

  renderList(
    nodes.lowStockList,
    state.stats.lowStock,
    (item) => ({
      title: item.name,
      subtitle: 'Stock critico',
      value: `${item.stockQuantity} u.`,
      date: ''
    })
  );
}

function renderTreasurySummary() {
  const income = state.transactions
    .filter((item) => isPositiveTransaction(item.transactionType))
    .reduce((sum, item) => sum + item.amount, 0);
  const expense = state.transactions
    .filter((item) => !isPositiveTransaction(item.transactionType))
    .reduce((sum, item) => sum + item.amount, 0);
  const balance = income - expense;

  nodes.treasuryBalance.textContent = money(balance);
  nodes.treasuryIncome.textContent = money(income);
  nodes.treasuryExpense.textContent = money(expense);
  nodes.treasuryCount.textContent = String(state.transactions.length);
}

function renderCategories() {
  const current = nodes.categoryFilter.value;
  nodes.categoryFilter.innerHTML = '<option value="">Todos los rubros</option>';
  nodes.categoryOptions.innerHTML = '';

  state.categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category.name;
    option.textContent = category.name;
    nodes.categoryFilter.append(option);

    const dataOption = document.createElement('option');
    dataOption.value = category.name;
    nodes.categoryOptions.append(dataOption);
  });

  nodes.categoryFilter.value = current;
}

function renderProducts() {
  const search = nodes.searchInput.value.trim().toLowerCase();
  const category = nodes.categoryFilter.value;
  const visibleProducts = state.products.filter((product) => {
    const matchesCategory = !category || product.category === category;
    const haystack = `${product.name} ${product.description} ${product.category}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    return matchesCategory && matchesSearch;
  });

  nodes.productsTable.innerHTML = '';

  if (visibleProducts.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="6" class="empty-row">No hay repuestos para mostrar.</td>';
    nodes.productsTable.append(row);
    return;
  }

  visibleProducts.forEach((product) => {
    const fragment = nodes.productTemplate.content.cloneNode(true);
    const row = fragment.querySelector('tr');

    row.querySelector('[data-name]').textContent = product.name;
    row.querySelector('[data-description]').textContent = product.description || 'Sin descripcion';
    row.querySelector('[data-category]').textContent = product.category;
    row.querySelector('[data-price]').textContent = money(product.price);
    row.querySelector('[data-stock]').textContent = `${product.stockQuantity}`;
    row.querySelector('[data-status]').innerHTML = `<span class="badge ${stockBadge(product.stockQuantity)}">${stockLabel(product)}</span>`;

    renderProductThumb(row, product);

    const saleButton = row.querySelector('[data-sale]');
    saleButton.disabled = product.stockQuantity <= 0;
    saleButton.textContent = product.stockQuantity <= 0 ? 'Sin stock' : 'Vender 1';
    saleButton.addEventListener('click', () => quickSellProduct(product));
    row.querySelector('[data-edit]').addEventListener('click', () => fillProductForm(product));
    row.querySelector('[data-delete]').addEventListener('click', () => deleteProduct(product.id));
    nodes.productsTable.append(fragment);
  });
}

function renderProductThumb(row, product) {
  const image = row.querySelector('[data-image]');
  const placeholder = row.querySelector('[data-placeholder]');

  placeholder.textContent = thumbLabel(product.category || product.name || 'RP');
  placeholder.hidden = false;
  image.hidden = true;
  image.removeAttribute('src');

  if (!product.image) {
    return;
  }

  image.src = product.image;
  image.alt = product.name;
  image.hidden = false;
  placeholder.hidden = true;
  image.addEventListener(
    'error',
    () => {
      image.hidden = true;
      image.removeAttribute('src');
      placeholder.hidden = false;
    },
    { once: true }
  );
}

function renderMovementBuilder() {
  nodes.movementLines.innerHTML = '';

  const sortedProducts = state.products.slice().sort((a, b) => a.name.localeCompare(b.name));

  state.movementDraft.items.forEach((item, index) => {
    const fragment = nodes.movementLineTemplate.content.cloneNode(true);
    const line = fragment.querySelector('.movement-line');
    const productSelect = fragment.querySelector('[data-line-product]');
    const quantityInput = fragment.querySelector('[data-line-quantity]');
    const stockLabel = fragment.querySelector('[data-line-stock]');
    const subtotalLabel = fragment.querySelector('[data-line-subtotal]');
    const removeButton = fragment.querySelector('[data-remove-line]');

    line.dataset.lineKey = String(item.key);

    sortedProducts.forEach((product) => {
      const option = document.createElement('option');
      option.value = String(product.id);
      option.textContent = `${product.name} (${product.stockQuantity} u.)`;
      productSelect.append(option);
    });

    productSelect.value = item.productId ? String(item.productId) : '';
    quantityInput.value = String(item.quantity);
    quantityInput.dataset.lineKey = String(item.key);
    productSelect.dataset.lineKey = String(item.key);

    const selectedProduct = state.products.find((product) => product.id === item.productId);
    stockLabel.textContent = selectedProduct ? `Stock actual: ${selectedProduct.stockQuantity}` : 'Stock: -';
    subtotalLabel.textContent = movementTypeIsSale()
      ? money((selectedProduct?.price || 0) * item.quantity)
      : `${item.quantity} u.`;

    productSelect.addEventListener('change', (event) => {
      updateMovementLine(item.key, 'productId', Number(event.target.value) || null);
    });

    quantityInput.addEventListener('change', (event) => {
      updateMovementLine(item.key, 'quantity', clampQuantity(event.target.value));
    });

    removeButton.disabled = state.movementDraft.items.length === 1;
    removeButton.addEventListener('click', () => removeMovementLine(item.key));

    nodes.movementLines.append(fragment);

    if (index === 0 && !item.productId && nodes.movementDefaultQuantity.value) {
      quantityInput.value = String(item.quantity);
    }
  });

  syncMovementSummary();
}

function addMovementLine() {
  state.movementDraft.items.push(createMovementLineItem(state.movementDraft.nextKey++, clampQuantity(nodes.movementDefaultQuantity.value)));
  renderMovementBuilder();
}

function removeMovementLine(key) {
  if (state.movementDraft.items.length === 1) {
    return;
  }

  state.movementDraft.items = state.movementDraft.items.filter((item) => item.key !== key);
  renderMovementBuilder();
}

function updateMovementLine(key, field, value) {
  state.movementDraft.items = state.movementDraft.items.map((item) =>
    item.key === key ? { ...item, [field]: value } : item
  );
  renderMovementBuilder();
}

function syncMovementMode() {
  const type = nodes.movementType.value;
  nodes.movementIntro.textContent = MOVEMENT_COPY[type] || MOVEMENT_COPY.OUT;
  nodes.movementPaymentShell.hidden = type !== 'SALE';
  nodes.movementReferenceShell.hidden = type !== 'SALE';

  const currentReason = nodes.movementReason.value.trim();
  const defaults = new Set(['Venta de mostrador', 'Salida de stock', 'Ingreso de stock']);
  const nextDefault = defaultReasonForMovement(type);

  if (!currentReason || defaults.has(currentReason)) {
    nodes.movementReason.value = nextDefault;
  }

  if (type !== 'SALE') {
    nodes.movementPaymentMethod.value = '';
    nodes.movementReference.value = '';
  }

  syncMovementSummary();
}

function syncMovementSummary() {
  const items = getMovementItemsForSave();
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = items.reduce((sum, item) => {
    const product = state.products.find((current) => current.id === item.productId);
    return sum + (product?.price || 0) * item.quantity;
  }, 0);

  nodes.movementLineCount.textContent = String(state.movementDraft.items.length);
  nodes.movementTotalQuantity.textContent = String(totalQuantity);
  nodes.movementTotalAmount.textContent = movementTypeIsSale() ? money(totalAmount) : 'No aplica';
}

function getMovementItemsForSave() {
  return state.movementDraft.items
    .map((item) => ({
      productId: Number(item.productId),
      quantity: clampQuantity(item.quantity)
    }))
    .filter((item) => Number.isInteger(item.productId) && item.productId > 0 && item.quantity > 0);
}

function createMovementLineItem(key, quantity = 1) {
  return {
    key,
    productId: null,
    quantity: clampQuantity(quantity)
  };
}

function clampQuantity(value) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
}

function movementTypeIsSale() {
  return nodes.movementType.value === 'SALE';
}

function defaultReasonForMovement(type) {
  switch (type) {
    case 'IN':
      return 'Ingreso de stock';
    case 'SALE':
      return 'Venta de mostrador';
    default:
      return 'Salida de stock';
  }
}

function movementTitle(item) {
  if (item.movementType === 'SALE') {
    return item.items?.length > 1 ? `Venta multiple - ${item.productName}` : `Venta - ${item.productName}`;
  }

  return `${item.productName} - ${item.movementType === 'IN' ? 'Entrada' : 'Salida'}`;
}

function renderMovements() {
  renderList(
    nodes.movementLog,
    state.movements,
    (item) => ({
      title: movementTitle(item),
      subtitle: `${item.reason}${item.note ? ` - ${item.note}` : ''}`,
      value: item.totalAmount != null && item.movementType === 'SALE'
        ? `${item.quantity} u. · ${money(item.totalAmount)}`
        : `${item.movementType === 'IN' ? '+' : '-'}${item.quantity}`,
      date: item.createdAt
    })
  );
}

function renderTransactions() {
  nodes.transactionsTable.innerHTML = '';

  if (state.transactions.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="6" class="empty-row">No hay transacciones para mostrar.</td>';
    nodes.transactionsTable.append(row);
    renderTreasurySummary();
    return;
  }

  state.transactions.forEach((transaction) => {
    const fragment = nodes.transactionRowTemplate.content.cloneNode(true);
    const row = fragment.querySelector('tr');
    row.querySelector('[data-type]').textContent = transactionTypeLabel(transaction.transactionType);
    row.querySelector('[data-category]').textContent = transaction.category;
    row.querySelector('[data-amount]').textContent = money(signedAmount(transaction));
    row.querySelector('[data-method]').textContent = transaction.paymentMethod || '-';
    row.querySelector('[data-date]').textContent = formatDate(transaction.occurredAt);
    row.querySelector('[data-delete]').addEventListener('click', () => deleteTransaction(transaction.id));
    nodes.transactionsTable.append(fragment);
  });

  renderTreasurySummary();
}

function renderList(container, items, mapper) {
  container.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'list-empty';
    empty.textContent = 'Sin datos para mostrar.';
    container.append(empty);
    return;
  }

  items.forEach((item) => {
    const mapped = mapper(item);
    const fragment = nodes.listItemTemplate.content.cloneNode(true);
    fragment.querySelector('[data-title]').textContent = mapped.title;
    fragment.querySelector('[data-subtitle]').textContent = mapped.subtitle;
    fragment.querySelector('[data-value]').textContent = mapped.value;
    fragment.querySelector('[data-date]').textContent = mapped.date ? formatDate(mapped.date) : '';
    container.append(fragment);
  });
}

function renderBarChart(container, rows, series, labelKey) {
  container.innerHTML = '';

  if (!rows.length) {
    container.innerHTML = '<div class="chart-empty">Sin datos suficientes.</div>';
    return;
  }

  const maxValue = Math.max(
    1,
    ...rows.flatMap((row) => series.map((item) => Number(row[item.key] || 0)))
  );

  rows.forEach((row) => {
    const group = document.createElement('div');
    group.className = 'chart-group';

    const label = document.createElement('span');
    label.className = 'chart-label';
    label.textContent = row[labelKey];
    group.append(label);

    const bars = document.createElement('div');
    bars.className = 'bars';

    series.forEach((item) => {
      const value = Number(row[item.key] || 0);
      const bar = document.createElement('div');
      bar.className = `bar ${item.className}`;
      bar.style.height = `${Math.max(8, (value / maxValue) * 180)}px`;
      bar.title = `${item.label}: ${value}`;
      bars.append(bar);
    });

    group.append(bars);
    container.append(group);
  });
}

function renderStackChart(container, rows, labelKey, valueKey) {
  container.innerHTML = '';

  if (!rows.length) {
    container.innerHTML = '<div class="chart-empty">Sin gastos cargados este mes.</div>';
    return;
  }

  const total = rows.reduce((sum, row) => sum + Number(row[valueKey] || 0), 0) || 1;

  rows.forEach((row, index) => {
    const item = document.createElement('div');
    item.className = 'stack-item';
    const percent = (Number(row[valueKey]) / total) * 100;
    item.innerHTML = `
      <div class="stack-top">
        <strong>${row[labelKey]}</strong>
        <span>${money(row[valueKey])}</span>
      </div>
      <div class="stack-track">
        <div class="stack-fill fill-${(index % 5) + 1}" style="width:${percent}%"></div>
      </div>
    `;
    container.append(item);
  });
}

function syncTopMetrics() {
  const summary = state.dashboard.summary || {};
  const totalStock = state.products.reduce((sum, item) => sum + item.stockQuantity, 0);

  nodes.metricProducts.textContent = String(summary.totalProducts ?? state.products.length ?? 0);
  nodes.metricStock.textContent = String(summary.totalStock ?? totalStock);
}

function fillProductForm(product) {
  state.pendingProductPayload = null;
  state.editingId = product.id;
  nodes.formTitle.textContent = `Editar repuesto #${product.id}`;
  nodes.productId.value = String(product.id);
  nodes.productName.value = product.name;
  nodes.productDescription.value = product.description || '';
  nodes.productCategory.value = product.category;
  nodes.productPrice.value = String(product.price);
  nodes.productStock.value = String(product.stockQuantity);
  nodes.productImage.value = product.image || '';
  nodes.productFeatured.checked = Boolean(product.featured);
  switchView('inventory');
  openProductFormModal();
}

function resetProductForm() {
  state.editingId = null;
  state.pendingProductPayload = null;
  nodes.formTitle.textContent = 'Nuevo repuesto';
  nodes.productForm.reset();
  nodes.productId.value = '';
}

function openProductFormModal() {
  nodes.productFormModal.classList.add('is-open');
  nodes.productFormModal.setAttribute('aria-hidden', 'false');
  syncModalBodyState();
  window.requestAnimationFrame(() => {
    nodes.productName.focus();
  });
}

function closeProductFormModal() {
  nodes.productFormModal.classList.remove('is-open');
  nodes.productFormModal.setAttribute('aria-hidden', 'true');
  resetProductForm();
  syncModalBodyState();
}

async function saveProduct(event) {
  event.preventDefault();

  const payload = buildProductPayload();
  if (!payload) {
    return;
  }

  const endpoint = state.editingId ? `/api/products/${state.editingId}` : '/api/products';
  const method = state.editingId ? 'PUT' : 'POST';

  if (!state.editingId) {
    state.pendingProductPayload = payload;
    openProductConfirmModal(payload);
    return;
  }

  await request(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  closeProductFormModal();
  await refreshAllData();
  window.alert('Repuesto actualizado correctamente.');
}

function buildProductPayload() {
  const name = nodes.productName.value.trim();
  const description = nodes.productDescription.value.trim();
  const category = nodes.productCategory.value.trim();
  const price = Number(nodes.productPrice.value);
  const stockQuantity = Number(nodes.productStock.value);
  const image = nodes.productImage.value.trim();

  if (!name) {
    window.alert('El nombre del repuesto es obligatorio.');
    nodes.productName.focus();
    return null;
  }

  if (!category) {
    window.alert('El rubro del repuesto es obligatorio.');
    nodes.productCategory.focus();
    return null;
  }

  if (!Number.isFinite(price) || price < 0) {
    window.alert('El precio debe ser un numero valido mayor o igual a 0.');
    nodes.productPrice.focus();
    return null;
  }

  if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
    window.alert('El stock debe ser un entero valido mayor o igual a 0.');
    nodes.productStock.focus();
    return null;
  }

  return {
    name,
    description,
    category,
    price,
    stockQuantity,
    image,
    featured: nodes.productFeatured.checked
  };
}

function openProductConfirmModal(payload) {
  nodes.productConfirmSummary.innerHTML = `
    <div class="confirm-row"><span>Nombre</span><strong>${escapeHtml(payload.name)}</strong></div>
    <div class="confirm-row"><span>Rubro</span><strong>${escapeHtml(payload.category)}</strong></div>
    <div class="confirm-row"><span>Precio</span><strong>${money(payload.price)}</strong></div>
    <div class="confirm-row"><span>Stock inicial</span><strong>${payload.stockQuantity}</strong></div>
    <div class="confirm-row"><span>Alta rotacion</span><strong>${payload.featured ? 'Si' : 'No'}</strong></div>
  `;
  nodes.productConfirmModal.classList.add('is-open');
  nodes.productConfirmModal.setAttribute('aria-hidden', 'false');
  syncModalBodyState();
}

function closeProductConfirmModal() {
  nodes.productConfirmModal.classList.remove('is-open');
  nodes.productConfirmModal.setAttribute('aria-hidden', 'true');
  syncModalBodyState();
}

async function confirmProductCreation() {
  if (!state.pendingProductPayload) {
    closeProductConfirmModal();
    return;
  }

  await request('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.pendingProductPayload)
  });

  closeProductConfirmModal();
  closeProductFormModal();
  await refreshAllData();
  window.alert('Repuesto creado correctamente.');
}

async function saveMovement(event) {
  event.preventDefault();

  const items = getMovementItemsForSave();

  if (!items.length) {
    window.alert('Agrega al menos un repuesto valido al movimiento.');
    return;
  }

  await request('/api/stock-movements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      movementType: nodes.movementType.value,
      items,
      reason: nodes.movementReason.value,
      paymentMethod: nodes.movementPaymentMethod.value,
      reference: nodes.movementReference.value,
      note: nodes.movementNote.value
    })
  });

  nodes.movementForm.reset();
  state.movementDraft = {
    nextKey: 2,
    items: [createMovementLineItem(1)]
  };
  nodes.movementType.value = 'SALE';
  nodes.movementDefaultQuantity.value = '1';
  syncMovementMode();
  renderMovementBuilder();
  await refreshAllData();
}

async function saveTransaction(event) {
  event.preventDefault();

  await request('/api/treasury/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transactionType: nodes.txType.value,
      category: nodes.txCategory.value,
      amount: Number(nodes.txAmount.value),
      paymentMethod: nodes.txMethod.value,
      reference: nodes.txReference.value,
      occurredAt: nodes.txDate.value ? new Date(nodes.txDate.value).toISOString() : new Date().toISOString(),
      note: nodes.txNote.value
    })
  });

  nodes.treasuryForm.reset();
  nodes.txDate.value = toDateTimeLocal(new Date());
  await refreshAllData();
}

async function quickSellProduct(product) {
  if (product.stockQuantity <= 0) {
    window.alert('Ese repuesto ya no tiene stock disponible.');
    return;
  }

  const confirmed = window.confirm(
    `Registrar venta rapida de 1 unidad de ${product.name} por ${money(product.price)}?`
  );

  if (!confirmed) {
    return;
  }

  await request(`/api/products/${product.id}/quick-sale`, {
    method: 'POST'
  });

  await refreshAllData();
  window.alert(`Venta rapida registrada para ${product.name}.`);
}

async function deleteProduct(id) {
  if (!window.confirm(`Vas a borrar el repuesto ${id}. No hay papelera. Seguir?`)) {
    return;
  }

  await request(`/api/products/${id}`, { method: 'DELETE' });
  if (state.editingId === id) {
    closeProductFormModal();
  }
  await refreshAllData();
}

function syncModalBodyState() {
  const hasOpenModal =
    nodes.productConfirmModal.classList.contains('is-open') || nodes.productFormModal.classList.contains('is-open');
  document.body.classList.toggle('modal-open', hasOpenModal);
}

async function deleteTransaction(id) {
  if (!window.confirm(`Vas a borrar la transaccion ${id}. Seguir?`)) {
    return;
  }

  await request(`/api/treasury/transactions/${id}`, { method: 'DELETE' });
  await refreshAllData();
}

async function refreshAllData() {
  await loadAppData();
}

async function request(url, options) {
  const response = await authorizedFetch(url, options);

  if (response.status === 401) {
    clearSession();
    showAuthShell('La sesion vencio. Volve a iniciar sesion.');
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    let message = 'Request failed';
    try {
      const body = await response.json();
      if (body?.error) {
        message = body.error;
      }
    } catch (error) {
      message = response.statusText || message;
    }
    window.alert(message);
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function authorizedFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});

  if (state.auth.token) {
    headers.set('Authorization', `Bearer ${state.auth.token}`);
  }

  return fetch(url, {
    ...options,
    headers
  });
}

function titleForView(viewName) {
  switch (viewName) {
    case 'inventory':
      return 'Inventario';
    case 'output':
      return 'Movimientos';
    case 'stats':
      return 'Estadisticas';
    case 'treasury':
      return 'Caja';
    default:
      return 'Mostrador';
  }
}

function copyForView(viewName) {
  switch (viewName) {
    case 'inventory':
      return 'Catalogo de repuestos con busqueda rapida y edicion simple.';
    case 'output':
      return 'Ventas completas, salidas y entradas de stock desde un flujo mas claro y menos tosco.';
    case 'stats':
      return 'Lectura rapida de rotacion, volumen y zonas criticas.';
    case 'treasury':
      return 'Caja diaria, compras y gastos sin mezclar todo en una sola planilla mental.';
    default:
      return 'Vista general de stock, movimientos y caja con foco en operacion real.';
  }
}

function isPositiveTransaction(type) {
  return ['INCOME', 'SALE', 'CAPITAL'].includes(type);
}

function signedAmount(transaction) {
  return isPositiveTransaction(transaction.transactionType) ? transaction.amount : -transaction.amount;
}

function transactionTypeLabel(type) {
  switch (type) {
    case 'INCOME':
      return 'Ingreso';
    case 'SALE':
      return 'Venta';
    case 'CAPITAL':
      return 'Capital';
    case 'PURCHASE':
      return 'Compra';
    case 'WITHDRAWAL':
      return 'Retiro';
    case 'TAX':
      return 'Impuesto';
    default:
      return 'Gasto';
  }
}

function stockLabel(product) {
  if (product.stockQuantity <= 0) {
    return 'Sin stock';
  }
  if (product.stockQuantity <= 5) {
    return 'Critico';
  }
  if (product.featured) {
    return 'Alta rotacion';
  }
  return 'Estable';
}

function stockBadge(stock) {
  if (stock <= 0) {
    return 'badge-danger';
  }
  if (stock <= 5) {
    return 'badge-warning';
  }
  return 'badge-ok';
}

function money(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(value);
}

function formatDate(value) {
  if (!value) {
    return '';
  }
  return new Date(value).toLocaleString();
}

function toDateTimeLocal(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function debounce(callback, wait) {
  let timeoutId;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), wait);
  };
}

function thumbLabel(value) {
  const cleaned = String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() || '')
    .join('');

  return cleaned || 'RP';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
