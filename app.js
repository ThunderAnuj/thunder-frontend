const API_URL = 'https://thunder-backend-esf1.onrender.com/api';

let isAdminUnlocked = false; 
let masterTransactions = [];
let masterAuditLogs = [];
let currentFilteredData = []; // Caches current view for PDF Export

let currentPage = 1;
const rowsPerPage = 50;
const noPaginationViews = ['This Month', 'This Week', 'Category Month', 'All Month'];

let currentViews = { 'expense-section': 'This Month', 'cash-section': 'This Month', 'bank-section': 'This Month' };
let currentSorts = { 'expense-section': 'date-desc', 'cash-section': 'date-desc', 'bank-section': 'date-desc' };
let currentSubFilters = { 'expense-section': '', 'cash-section': '', 'bank-section': '' };

let categoryChartInst = null;
let cashflowChartInst = null;

function enforceDateRules() {
    const now = new Date();
    const localDate = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    const dateInput = document.getElementById('date');
    if (dateInput) { dateInput.max = localDate; if (!dateInput.value) dateInput.value = localDate; }
    const editDateInput = document.getElementById('edit-date');
    if (editDateInput) editDateInput.max = localDate;
    return localDate;
}

function openTab(evt, tabName) {
    let tabContents = document.getElementsByClassName("tab-content");
    for (let i = 0; i < tabContents.length; i++) tabContents[i].classList.remove("active");
    
    let tabBtns = document.getElementsByClassName("tab-btn");
    for (let i = 0; i < tabBtns.length; i++) tabBtns[i].classList.remove("active");
    
    document.getElementById(tabName).classList.add("active");
    evt.currentTarget.classList.add("active");

    if (currentSorts[tabName]) {
        const globalSortEl = document.getElementById('global-sort');
        if(globalSortEl) globalSortEl.value = currentSorts[tabName];
    }

    if (tabName === 'search-section') {
        document.getElementById('pagination-controls').style.display = 'none';
        runUniversalSearch();
    } else if (tabName === 'dashboard-section') {
        document.getElementById('pagination-controls').style.display = 'none';
        renderDashboard();
    } else {
        processAndRenderTables();
    }
}

function changeGlobalSort(val) {
    let activeTab = 'expense-section'; 
    const activeTabEl = document.querySelector('.tab-content.active');
    if (activeTabEl) activeTab = activeTabEl.id;
    currentSorts[activeTab] = val;
    currentPage = 1;
    processAndRenderTables();
}

function setView(tabId, viewName, btnElement) {
    currentViews[tabId] = viewName;
    currentSubFilters[tabId] = ''; 
    const container = btnElement.parentElement;
    container.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');
    updateSubFilterUI(tabId, viewName);
    currentPage = 1;
    processAndRenderTables();
}

function updateSubFilterUI(tabId, viewName) {
    const container = document.getElementById(`sub-filter-container-${tabId}`);
    if (!container) return;
    
    if (viewName === 'Category' || viewName === 'Category Month') {
        let cats = [...new Set(masterTransactions.map(t => t.category).filter(Boolean))].sort();
        let catOptions = `<option value="">Select Category...</option>`;
        cats.forEach(c => catOptions += `<option value="${c}">${c}</option>`);
        container.innerHTML = `<select class="sub-filter-select" onchange="changeSubFilter('${tabId}', this.value)">${catOptions}</select>`;
        container.style.display = 'block';
    } 
    else if (viewName === 'All Month') {
        let months = [...new Set(masterTransactions.map(t => t.date.substring(0, 7)))].sort().reverse();
        let monthOptions = `<option value="">Select Month...</option>`;
        months.forEach(m => {
            let dateObj = new Date(m + "-01");
            let label = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
            monthOptions += `<option value="${m}">${label}</option>`;
        });
        container.innerHTML = `<select class="sub-filter-select" onchange="changeSubFilter('${tabId}', this.value)">${monthOptions}</select>`;
        container.style.display = 'block';
    } 
    else {
        container.style.display = 'none';
        container.innerHTML = '';
    }
}

function changeSubFilter(tabId, val) { currentSubFilters[tabId] = val; currentPage = 1; processAndRenderTables(); }
function saveWeekStartDay() { localStorage.setItem('weekStartDay', document.getElementById('week-start-day').value); processAndRenderTables(); }

async function loadData() {
    enforceDateRules(); 
    try {
        const res = await fetch(`${API_URL}/transactions`);
        masterTransactions = await res.json();
        const auditRes = await fetch(`${API_URL}/audit`);
        masterAuditLogs = await auditRes.json();
        const catRes = await fetch(`${API_URL}/categories`);
        const categories = await catRes.json();
        const setRes = await fetch(`${API_URL}/settings`);
        const settings = await setRes.json();

        if (settings) {
            document.getElementById('opening-cash').value = settings.openingCash || 0;
            document.getElementById('opening-bank').value = settings.openingBank || 0;
            if(settings.editorUsername) document.getElementById('set-editor-username').value = settings.editorUsername;
            if(settings.editorPassword) document.getElementById('set-editor-pass').value = settings.editorPassword;
        }

        calculateBalances(masterTransactions, settings);
        renderCategories(categories);
        renderDashboard();
        
        if(!document.getElementById('dashboard-section').classList.contains('active')) {
            processAndRenderTables();
        }
    } catch (error) {
        console.error("Error connecting to Vault:", error);
    }
}

function renderDashboard() {
    const catCanvas = document.getElementById('categoryChart');
    const flowCanvas = document.getElementById('cashflowChart');
    if (!catCanvas || !flowCanvas) return;

    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#f8fafc' : '#1e293b';
    const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    Chart.defaults.color = textColor;

    const today = new Date();
    const currentMonthStr = today.toISOString().substring(0, 7);

    let monthExpenses = 0;
    let catTotals = {};
    masterTransactions.forEach(t => {
        if (t.type === 'Expense' && t.date.startsWith(currentMonthStr)) {
            monthExpenses += Number(t.amount);
            catTotals[t.category] = (catTotals[t.category] || 0) + Number(t.amount);
        }
    });
    document.getElementById('dash-month-expense').innerText = monthExpenses.toLocaleString('en-IN');

    if (categoryChartInst) categoryChartInst.destroy();
    categoryChartInst = new Chart(catCanvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(catTotals),
            datasets: [{
                data: Object.values(catTotals),
                backgroundColor: ['#ff0844', '#ffb199', '#4facfe', '#00f2fe', '#f6d365', '#fda085', '#a1c4fd', '#c2e9fb', '#667eea', '#764ba2'],
                borderWidth: 0
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, resizeDelay: 200, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { family: 'Poppins', size: 10 } } } } }
    });

    let flowData = {};
    for (let i = 5; i >= 0; i--) {
        let d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        let label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
        let key = d.toISOString().substring(0, 7);
        flowData[key] = { label: label, in: 0, out: 0 };
    }

    masterTransactions.forEach(t => {
        let monthKey = t.date.substring(0, 7);
        if (flowData[monthKey]) {
            let amt = Number(t.amount);
            if (t.type === 'Receipt') flowData[monthKey].in += amt;
            if (t.type === 'Expense') flowData[monthKey].out += amt;
        }
    });

    const labels = Object.values(flowData).map(x => x.label);
    const dataIn = Object.values(flowData).map(x => x.in);
    const dataOut = Object.values(flowData).map(x => x.out);

    if (cashflowChartInst) cashflowChartInst.destroy();
    cashflowChartInst = new Chart(flowCanvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Money In', data: dataIn, backgroundColor: '#10b981', borderRadius: 4 },
                { label: 'Money Out', data: dataOut, backgroundColor: '#ef4444', borderRadius: 4 }
            ]
        },
        options: { 
            responsive: true, maintainAspectRatio: false, resizeDelay: 200,
            scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { grid: { color: gridColor }, ticks: { font: { size: 10 } } } },
            plugins: { legend: { labels: { font: { family: 'Poppins', size: 10 } } } } 
        }
    });
}

function prevPage() { if (currentPage > 1) { currentPage--; processAndRenderTables(); } }
function nextPage() { currentPage++; processAndRenderTables(); }

function processAndRenderTables() {
    let activeTab = 'expense-section'; 
    const activeTabEl = document.querySelector('.tab-content.active');
    if (activeTabEl) activeTab = activeTabEl.id;

    const currentView = currentViews[activeTab] || 'All';
    const currentSort = currentSorts[activeTab] || 'date-desc';
    const subFilter = currentSubFilters[activeTab] || '';

    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const startDay = parseInt(localStorage.getItem('weekStartDay') || '1');

    let filteredTx = masterTransactions.filter(t => {
        if (activeTab === 'expense-section' && t.type !== 'Expense') return false;
        if (activeTab === 'cash-section' && !(t.account === 'Cash' || t.type === 'Contra')) return false;
        if (activeTab === 'bank-section' && !(t.account === 'Bank Account' || t.type === 'Contra')) return false;

        const tDate = new Date(t.date);
        if (currentView === 'This Month' || currentView === 'Category Month') {
            if (tDate.getMonth() !== currentMonth || tDate.getFullYear() !== currentYear) return false;
        }
        if (currentView === 'This Week') {
            const current = new Date();
            const dayOfWeek = current.getDay();
            const offset = (dayOfWeek < startDay) ? (dayOfWeek - startDay + 7) : (dayOfWeek - startDay);
            const weekStart = new Date(current);
            weekStart.setDate(current.getDate() - offset);
            weekStart.setHours(0,0,0,0);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            weekEnd.setHours(23,59,59,999);
            if (tDate < weekStart || tDate > weekEnd) return false;
        }
        if (currentView === 'All Month' && subFilter !== '') {
            if (!t.date.startsWith(subFilter)) return false;
        }
        if ((currentView === 'Category' || currentView === 'Category Month') && subFilter !== '') {
            if (t.category !== subFilter) return false;
        }
        return true;
    });

    filteredTx.sort((a, b) => {
        if (currentSort === 'date-desc') return new Date(b.date) - new Date(a.date);
        if (currentSort === 'date-asc') return new Date(a.date) - new Date(b.date);
        if (currentSort === 'amount-desc') return b.amount - a.amount;
        if (currentSort === 'amount-asc') return a.amount - b.amount;
        if (currentSort === 'particulars-asc') return a.particulars.localeCompare(b.particulars);
        if (currentSort === 'particulars-desc') return b.particulars.localeCompare(a.particulars);
    });

    currentFilteredData = filteredTx;

    let pagedTx = filteredTx;
    const paginatedTabs = ['expense-section', 'cash-section', 'bank-section'];
    if (!paginatedTabs.includes(activeTab) || noPaginationViews.includes(currentView) || (currentView === 'All Month' && subFilter !== '') || (currentView === 'Category' && subFilter !== '')) {
        document.getElementById('pagination-controls').style.display = 'none';
    } else {
        document.getElementById('pagination-controls').style.display = 'flex';
        const maxPages = Math.ceil(filteredTx.length / rowsPerPage) || 1;
        if (currentPage > maxPages) currentPage = maxPages;
        document.getElementById('page-info').innerText = `Page ${currentPage} of ${maxPages}`;
        const startIndex = (currentPage - 1) * rowsPerPage;
        const endIndex = startIndex + rowsPerPage;
        pagedTx = filteredTx.slice(startIndex, endIndex);
    }

    renderTables(pagedTx, masterAuditLogs, activeTab);
}

// --- PDF GENERATION ENGINE WITH FOOTER TOTALS ---

function exportTabToPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape'); 

    let activeTab = 'expense-section'; 
    const activeTabEl = document.querySelector('.tab-content.active');
    if (activeTabEl) activeTab = activeTabEl.id;

    if (['dashboard-section', 'entry-section', 'settings-section'].includes(activeTab)) {
        return alert("Please navigate to a Ledger, Statement, or Search tab to export data.");
    }

    let tabTitle = "Ledger Export";
    if(activeTab === 'expense-section') tabTitle = "Expense Ledger";
    if(activeTab === 'cash-section') tabTitle = "Cash Statement";
    if(activeTab === 'bank-section') tabTitle = "Bank Statement";
    if(activeTab === 'audit-section') tabTitle = "Audit Trail Security Log";
    if(activeTab === 'search-section') tabTitle = "Custom Search Results";
    
    let view = currentViews[activeTab] || 'All Data';
    let sub = currentSubFilters[activeTab] || '';
    let periodText = view;
    
    if(view === 'This Month' || view === 'Category Month') {
        periodText = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
    }
    if(sub) periodText += ` | ${sub}`;
    if(activeTab === 'search-section' || activeTab === 'audit-section') periodText = 'Custom Query';

    doc.setFontSize(20);
    doc.text(`Thunder Finance - ${tabTitle}`, 14, 20);
    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(`Context Scope: ${periodText}`, 14, 28);
    doc.text(`Generated On: ${new Date().toLocaleString()}`, 14, 34);

    let head = [];
    let body = [];
    let foot = [];
    
    if (activeTab === 'expense-section') {
        head = [['Date', 'Particulars', 'Category', 'Account', 'Amount', 'Note', 'Recorded By']];
        let totalExp = 0;
        body = currentFilteredData.map(t => {
            totalExp += Number(t.amount);
            return [t.date, t.particulars, t.category || '-', t.account, `Rs. ${t.amount.toLocaleString('en-IN')}`, t.notes || '-', t.recordedBy || 'Unknown'];
        });
        foot = [['', '', '', 'TOTAL EXPENSES:', `Rs. ${totalExp.toLocaleString('en-IN')}`, '', '']];
    } 
    else if (activeTab === 'cash-section' || activeTab === 'bank-section') {
        head = [['Date', 'Particulars', 'Type', 'Amount', 'Note', 'Recorded By']];
        let totalIn = 0;
        let totalOut = 0;
        body = currentFilteredData.map(t => {
            let isInc = (t.type === 'Receipt' && t.account === (activeTab === 'cash-section' ? 'Cash' : 'Bank Account')) || (t.type === 'Contra' && t.account === (activeTab === 'cash-section' ? 'Bank Account' : 'Cash'));
            if (isInc) totalIn += Number(t.amount); else totalOut += Number(t.amount);
            let typeStr = isInc ? 'IN' : 'OUT';
            return [t.date, t.particulars, t.type, `Rs. ${t.amount.toLocaleString('en-IN')} (${typeStr})`, t.notes || '-', t.recordedBy || 'Unknown'];
        });
        let net = totalIn - totalOut;
        foot = [['', '', 'NET TOTAL:', `IN: Rs.${totalIn.toLocaleString('en-IN')} | OUT: Rs.${totalOut.toLocaleString('en-IN')} | NET: Rs.${net.toLocaleString('en-IN')}`, '', '']];
    } 
    else if (activeTab === 'search-section') {
        head = [['Date', 'Particulars', 'Type', 'Account', 'Amount']];
        let totalAmt = 0;
        body = currentFilteredData.map(t => {
            totalAmt += Number(t.amount);
            return [t.date, t.particulars, t.type, t.account, `Rs. ${t.amount.toLocaleString('en-IN')}`]
        });
        foot = [['', '', '', 'TOTAL SEARCH AMOUNT:', `Rs. ${totalAmt.toLocaleString('en-IN')}`]];
    }
    else if (activeTab === 'audit-section') {
        head = [['Log Date', 'Status', 'Original Date', 'Particulars', 'Amount', 'Recorded By']];
        body = masterAuditLogs.map(log => [log.dateChanged, log.action, log.originalData.date, log.originalData.particulars, `Rs. ${log.originalData.amount.toLocaleString('en-IN')}`, log.originalData.recordedBy || 'Unknown']);
    }

    doc.autoTable({
        startY: 42,
        head: head,
        body: body,
        foot: foot,
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 10 },
        headStyles: { fillColor: [102, 126, 234] },
        footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' }
    });

    doc.save(`Thunder_${tabTitle.replace(/\s+/g, '_')}_${new Date().getTime()}.pdf`);
}

function generateMasterPDF() {
    const start = document.getElementById('master-export-start').value;
    const end = document.getElementById('master-export-end').value;

    if (!start || !end) return alert("Please select both a Start Date and End Date for the Master Export.");

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape');

    let exportData = masterTransactions.filter(t => t.date >= start && t.date <= end);
    exportData.sort((a,b) => new Date(a.date) - new Date(b.date));

    doc.setFontSize(22);
    doc.text(`Thunder Finance - MASTER DATABASE EXPORT`, 14, 20);
    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(`Global Timeframe: ${start} to ${end}`, 14, 28);
    doc.text(`Total Records Found: ${exportData.length}`, 14, 34);
    doc.text(`Generated On: ${new Date().toLocaleString()}`, 14, 40);

    let totalAmt = 0;
    const head = [['Date', 'Ledger', 'Particulars', 'Type', 'Category', 'Amount', 'Recorded By']];
    const body = exportData.map(t => {
        totalAmt += Number(t.amount);
        return [
            t.date, 
            t.account, 
            t.particulars, 
            t.type, 
            t.category || '-', 
            `Rs. ${t.amount.toLocaleString('en-IN')}`,
            t.recordedBy || 'Unknown'
        ];
    });
    
    const foot = [['', '', '', '', 'GRAND TOTAL:', `Rs. ${totalAmt.toLocaleString('en-IN')}`, '']];

    doc.autoTable({
        startY: 48,
        head: head,
        body: body,
        foot: foot,
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 9 },
        headStyles: { fillColor: [16, 185, 129] },
        footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' }
    });

    doc.save(`Thunder_Master_Export_${start}_to_${end}.pdf`);
}

function cloneEntry(id) {
    const t = masterTransactions.find(x => x._id === id);
    if(!t) return;
    
    document.querySelector('[onclick*="entry-section"]').click();
    
    document.getElementById('type').value = t.type;
    document.getElementById('particulars').value = t.particulars;
    document.getElementById('amount').value = t.amount;
    document.getElementById('account').value = t.account;
    document.getElementById('notes').value = t.notes || '';
    
    document.getElementById('type').dispatchEvent(new Event('change'));
    if(t.type === 'Expense') {
        document.getElementById('category').value = t.category || '';
    }
}

function renderTables(transactions, auditLogs, activeTab) {
    document.getElementById('expense-table-body').innerHTML = '';
    document.getElementById('cash-table-body').innerHTML = '';
    document.getElementById('bank-table-body').innerHTML = '';
    document.getElementById('audit-table-body').innerHTML = '';
    
    let expenseTotal = 0;
    let cashIn = 0, cashOut = 0;
    let bankIn = 0, bankOut = 0;

    transactions.forEach(t => {
        const amt = Number(t.amount);
        const editBtn = `<button class="edit-btn" onclick="openEditModal('${t._id}', '${t.date}', '${t.type}', '${encodeURIComponent(t.particulars)}', '${t.amount}', '${t.category || ''}', '${t.account}', '${encodeURIComponent(t.notes || '')}', '${t.recordedBy || 'System'}')">Edit</button>`;
        const cloneBtn = `<button class="secondary-btn" style="padding: 2px 6px; font-size: 10px; margin-right: 4px;" onclick="cloneEntry('${t._id}')" title="Clone Record">📋</button>`;
        const delBtn = isAdminUnlocked ? `<button class="del-btn" onclick="deleteEntry('${t._id}')">Delete</button>` : `<button class="del-btn" disabled style="opacity: 0.3; cursor:not-allowed;">Locked</button>`;
        const actionCell = `${cloneBtn} ${editBtn} ${delBtn}`;

        let displayNote = t.notes || '-'; // Inline badge removed based on preference

        if (activeTab === 'expense-section' && t.type === 'Expense') {
            expenseTotal += amt;
            document.getElementById('expense-table-body').innerHTML += `<tr><td data-label="Date">${t.date}</td><td data-label="Particulars">${t.particulars}</td><td data-label="Category">${t.category || '-'}</td><td data-label="Account">${t.account}</td><td data-label="Amount">₹${t.amount}</td><td data-label="Note">${displayNote}</td><td data-label="Action">${actionCell}</td></tr>`;
        }
        
        if (activeTab === 'cash-section' && (t.account === 'Cash' || t.type === 'Contra')) {
            let isCashIncrease = false;
            if (t.type === 'Receipt' && t.account === 'Cash') isCashIncrease = true;
            if (t.type === 'Contra' && t.account === 'Bank Account') isCashIncrease = true; 
            if (isCashIncrease) cashIn += amt; else cashOut += amt;

            const inOutBadge = isCashIncrease 
                ? `<span style="background-color: rgba(16, 185, 129, 0.2); color: #059669; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: 8px;">IN</span>`
                : `<span style="background-color: rgba(239, 68, 68, 0.2); color: #ef4444; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: 8px;">OUT</span>`;

            document.getElementById('cash-table-body').innerHTML += `<tr><td data-label="Date">${t.date}</td><td data-label="Particulars">${t.particulars}</td><td data-label="Type">${t.type}</td><td data-label="Amount">₹${t.amount} ${inOutBadge}</td><td data-label="Note">${displayNote}</td><td data-label="Action">${actionCell}</td></tr>`;
        }
        
        if (activeTab === 'bank-section' && (t.account === 'Bank Account' || t.type === 'Contra')) {
            let isBankIncrease = false;
            if (t.type === 'Receipt' && t.account === 'Bank Account') isBankIncrease = true;
            if (t.type === 'Contra' && t.account === 'Cash') isBankIncrease = true; 
            if (isBankIncrease) bankIn += amt; else bankOut += amt;

            const drCrBadge = isBankIncrease 
                ? `<span style="background-color: rgba(16, 185, 129, 0.2); color: #059669; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: 8px;">CR.</span>`
                : `<span style="background-color: rgba(239, 68, 68, 0.2); color: #ef4444; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: 8px;">DR.</span>`;

            document.getElementById('bank-table-body').innerHTML += `<tr><td data-label="Date">${t.date}</td><td data-label="Particulars">${t.particulars}</td><td data-label="Type">${t.type}</td><td data-label="Amount">₹${t.amount} ${drCrBadge}</td><td data-label="Note">${displayNote}</td><td data-label="Action">${actionCell}</td></tr>`;
        }
    });

    if(activeTab === 'expense-section') {
        const foot = document.getElementById('expense-table-foot');
        if(foot) foot.innerHTML = `<tr><td colspan="4" style="text-align: right;">Total View Expenses:</td><td colspan="3" style="color: #ef4444;">₹${expenseTotal.toLocaleString('en-IN')}</td></tr>`;
    }
    if(activeTab === 'cash-section') {
        const netCash = cashIn - cashOut;
        const netColor = netCash >= 0 ? '#10b981' : '#ef4444';
        const foot = document.getElementById('cash-table-foot');
        if(foot) foot.innerHTML = `<tr><td colspan="3" style="text-align: right;">View Totals:</td><td colspan="3"><span style="color: #10b981;">IN: ₹${cashIn.toLocaleString('en-IN')}</span> &nbsp;|&nbsp; <span style="color: #ef4444;">OUT: ₹${cashOut.toLocaleString('en-IN')}</span> &nbsp;|&nbsp; <span style="color: ${netColor}; font-weight: 800;">NET: ₹${netCash.toLocaleString('en-IN')}</span></td></tr>`;
    }
    if(activeTab === 'bank-section') {
        const netBank = bankIn - bankOut;
        const netColor = netBank >= 0 ? '#10b981' : '#ef4444';
        const foot = document.getElementById('bank-table-foot');
        if(foot) foot.innerHTML = `<tr><td colspan="3" style="text-align: right;">View Totals:</td><td colspan="3"><span style="color: #10b981;">IN: ₹${bankIn.toLocaleString('en-IN')}</span> &nbsp;|&nbsp; <span style="color: #ef4444;">OUT: ₹${bankOut.toLocaleString('en-IN')}</span> &nbsp;|&nbsp; <span style="color: ${netColor}; font-weight: 800;">NET: ₹${netBank.toLocaleString('en-IN')}</span></td></tr>`;
    }

    if (activeTab === 'audit-section') {
        auditLogs.forEach(log => {
            const old = log.originalData;
            const restoreBtn = `<button class="edit-btn" onclick="restoreEntry('${log._id}')">Restore</button>`;
            let details = `${old.date} | ${old.particulars} (₹${old.amount.toLocaleString('en-IN')})`;
            let user = old.recordedBy || '<span style="opacity:0.5">Unknown</span>';
            document.getElementById('audit-table-body').innerHTML += `<tr><td data-label="Log Date">${log.dateChanged}</td><td data-label="Status"><strong>${log.action}</strong></td><td data-label="Original Details">${details}</td><td data-label="Recorded By">${user}</td><td data-label="Action">${restoreBtn}</td></tr>`;
        });
    }
}

function runUniversalSearch() {
    const query = document.getElementById('uni-search').value.toLowerCase().trim();
    const type = document.getElementById('uni-type').value;
    const start = document.getElementById('uni-start').value;
    const end = document.getElementById('uni-end').value;
    const sort = document.getElementById('uni-sort').value;

    let results = masterTransactions.filter(t => {
        let matchesQuery = query === '' || 
            (t.particulars && t.particulars.toLowerCase().includes(query)) ||
            (t.notes && t.notes.toLowerCase().includes(query)) ||
            (t.category && t.category.toLowerCase().includes(query)) ||
            (t.account && t.account.toLowerCase().includes(query)) ||
            (t.amount && t.amount.toString().includes(query));

        let matchesType = type === '' || t.type === type;
        let matchesStart = start ? t.date >= start : true;
        let matchesEnd = end ? t.date <= end : true;
        return matchesQuery && matchesType && matchesStart && matchesEnd;
    });

    results.sort((a, b) => {
        if (sort === 'date-desc') return new Date(b.date) - new Date(a.date);
        if (sort === 'date-asc') return new Date(a.date) - new Date(b.date);
        if (sort === 'amount-desc') return b.amount - a.amount;
        if (sort === 'amount-asc') return a.amount - b.amount;
    });

    currentFilteredData = results;

    const tbody = document.getElementById('search-table-body');
    tbody.innerHTML = '';

    if(results.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 30px;">No matching records found.</td></tr>`;
        return;
    }

    results.forEach(t => {
        const editBtn = `<button class="edit-btn" onclick="openEditModal('${t._id}', '${t.date}', '${t.type}', '${encodeURIComponent(t.particulars)}', '${t.amount}', '${t.category || ''}', '${t.account}', '${encodeURIComponent(t.notes || '')}', '${t.recordedBy || 'System'}')">Edit</button>`;
        const delBtn = isAdminUnlocked ? `<button class="del-btn" onclick="deleteEntry('${t._id}')">Delete</button>` : `<button class="del-btn" disabled style="opacity: 0.3; cursor:not-allowed;">Locked</button>`;
        const actionCell = `${editBtn} ${delBtn}`;
        let amtColor = t.type === 'Receipt' ? '#10b981' : (t.type === 'Expense' ? '#ef4444' : 'inherit');
        tbody.innerHTML += `<tr><td data-label="Date">${t.date}</td><td data-label="Particulars">${t.particulars}</td><td data-label="Type">${t.type}</td><td data-label="Account">${t.account}</td><td data-label="Amount" style="color: ${amtColor}; font-weight: bold;">₹${t.amount}</td><td data-label="Action">${actionCell}</td></tr>`;
    });
}

function clearUniversalSearch() {
    document.getElementById('uni-search').value = '';
    document.getElementById('uni-type').value = '';
    document.getElementById('uni-start').value = '';
    document.getElementById('uni-end').value = '';
    document.getElementById('uni-sort').value = 'date-desc';
    runUniversalSearch();
}

function calculateBalances(transactions, settings) {
    let currentCash = settings ? Number(settings.openingCash) || 0 : 0;
    let currentBank = settings ? Number(settings.openingBank) || 0 : 0;
    transactions.forEach(t => {
        const amt = Number(t.amount) || 0;
        if (t.type === 'Receipt') { if (t.account === 'Cash') currentCash += amt; if (t.account === 'Bank Account') currentBank += amt; } 
        else if (t.type === 'Expense') { if (t.account === 'Cash') currentCash -= amt; if (t.account === 'Bank Account') currentBank -= amt; } 
        else if (t.type === 'Contra') { if (t.account === 'Cash') { currentCash -= amt; currentBank += amt; } else if (t.account === 'Bank Account') { currentBank -= amt; currentCash += amt; } }
    });
    document.getElementById('live-cash').innerText = currentCash.toLocaleString('en-IN');
    document.getElementById('live-bank').innerText = currentBank.toLocaleString('en-IN');
}

function renderCategories(categories) {
    const categoryDropdown = document.getElementById('category');
    const categoryTable = document.getElementById('category-table-body');
    categoryDropdown.innerHTML = '<option value="">Select a Category...</option>';
    categoryTable.innerHTML = '';
    categories.forEach(cat => {
        categoryDropdown.innerHTML += `<option value="${cat.name}">${cat.name}</option>`;
        const delBtn = `<button class="del-btn" onclick="deleteCategory('${cat._id}')">Delete</button>`;
        categoryTable.innerHTML += `<tr><td data-label="Category">${cat.name}</td><td data-label="Action">${delBtn}</td></tr>`;
    });
}

document.getElementById('entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const localDate = enforceDateRules();
    if (document.getElementById('date').value > localDate) return alert("Future/post-dated transactions are not allowed!");

    const newEntry = {
        date: document.getElementById('date').value,
        type: document.getElementById('type').value,
        particulars: document.getElementById('particulars').value,
        amount: Number(document.getElementById('amount').value),
        category: document.getElementById('category').value,
        account: document.getElementById('account').value,
        notes: document.getElementById('notes').value,
        recordedBy: document.getElementById('recorded-by').value 
    };
    await fetch(`${API_URL}/transactions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newEntry) });
    document.getElementById('entry-form').reset();
    
    const catSelect = document.getElementById('category');
    catSelect.disabled = false;
    catSelect.required = true;
    enforceDateRules(); 
    loadData();
});

function openEditModal(id, date, type, particulars, amount, category, account, notes, recordedBy) {
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-date').value = date;
    document.getElementById('edit-type').value = type;
    document.getElementById('edit-particulars').value = decodeURIComponent(particulars);
    document.getElementById('edit-amount').value = amount;
    document.getElementById('edit-account').value = account;
    const decodedNotes = decodeURIComponent(notes);
    document.getElementById('edit-notes').value = decodedNotes === '-' ? '' : decodedNotes;
    
    const userField = document.getElementById('edit-recorded-by');
    if (userField) userField.value = (recordedBy && recordedBy !== 'Unknown') ? recordedBy : 'System';

    const catDropdown = document.getElementById('edit-category');
    catDropdown.innerHTML = document.getElementById('category').innerHTML;
    if (type === 'Receipt' || type === 'Contra') { catDropdown.disabled = true; catDropdown.value = ''; } else { catDropdown.disabled = false; catDropdown.value = category; }
    
    enforceDateRules(); 
    document.getElementById('edit-modal').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('edit-modal').style.display = 'none';
    document.getElementById('edit-form').reset();
    document.getElementById('auth-editor-username').value = '';
    document.getElementById('auth-editor-pass').value = '';
}

document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const localDate = enforceDateRules();
    if (document.getElementById('edit-date').value > localDate) return alert("Future/post-dated transactions are not allowed!");

    const id = document.getElementById('edit-id').value;
    const updatedData = {
        date: document.getElementById('edit-date').value,
        type: document.getElementById('edit-type').value,
        particulars: document.getElementById('edit-particulars').value,
        amount: Number(document.getElementById('edit-amount').value),
        category: document.getElementById('edit-category').value,
        account: document.getElementById('edit-account').value,
        notes: document.getElementById('edit-notes').value,
        recordedBy: document.getElementById('edit-recorded-by').value 
    };
    const editorUsername = document.getElementById('auth-editor-username').value.trim();
    const editorPassword = document.getElementById('auth-editor-pass').value.trim();
    const res = await fetch(`${API_URL}/transactions/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ editorUsername, editorPassword, updatedData }) });
    const data = await res.json();
    if (res.ok) { alert("Transaction updated successfully!"); closeEditModal(); loadData(); } else { alert("Error: " + (data.error || "Authentication failed")); }
});

document.getElementById('editor-creds-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editorUsername = document.getElementById('set-editor-username').value.trim();
    const editorPassword = document.getElementById('set-editor-pass').value.trim();
    await fetch(`${API_URL}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ editorUsername, editorPassword }) });
    alert("Editor Credentials Saved Successfully!");
});

async function deleteEntry(id) {
    if (!isAdminUnlocked) return alert("Security Block: Please log in via the Settings tab to delete records.");
    if (confirm("Move to Audit Trail?")) { await fetch(`${API_URL}/transactions/${id}`, { method: 'DELETE', headers: { 'admin-access': 'true' } }); loadData(); }
}

async function restoreEntry(id) {
    if (confirm("Restore this record back to the Master Ledger?")) { await fetch(`${API_URL}/audit/restore/${id}`, { method: 'POST' }); alert("Record Restored!"); loadData(); }
}

document.getElementById('category-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const catName = document.getElementById('new-category-name').value;
    await fetch(`${API_URL}/categories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: catName }) });
    document.getElementById('category-form').reset();
    loadData();
});

async function deleteCategory(id) {
    if (confirm("Delete this category?")) { await fetch(`${API_URL}/categories/${id}`, { method: 'DELETE' }); loadData(); }
}

document.getElementById('balance-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const openingCash = Number(document.getElementById('opening-cash').value);
    const openingBank = Number(document.getElementById('opening-bank').value);
    await fetch(`${API_URL}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openingCash, openingBank, isAdminOverride: isAdminUnlocked }) });
    alert("Opening Balances Updated!"); loadData(); 
});

document.getElementById('admin-login-step1').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('admin-id').value;
    const pass = document.getElementById('admin-pass').value;
    const verifyRes = await fetch(`${API_URL}/security/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, pass }) });
    if (verifyRes.ok) {
        alert("Credentials Verified! Requesting OTP...");
        const res = await fetch(`${API_URL}/security/send-otp`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) { document.getElementById('admin-login-step1').style.display = 'none'; document.getElementById('admin-login-step2').style.display = 'flex'; } else { alert("Error: " + data.error); }
    } else { alert("Access Denied: Incorrect ID or Password."); }
});

document.getElementById('admin-login-step2').addEventListener('submit', async (e) => {
    e.preventDefault();
    const otp = document.getElementById('admin-otp').value.trim();
    const res = await fetch(`${API_URL}/security/verify-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otp }) });
    const data = await res.json();
    if (res.ok) {
        isAdminUnlocked = true;
        document.getElementById('admin-login-box').style.display = 'none';
        document.getElementById('admin-zone').style.display = 'block';
        document.getElementById('audit-tab-btn').style.display = 'inline-block';
        alert("Administrator Access Granted!");
        loadData(); 
    } else { alert(data.error || "Invalid OTP"); }
});

function logoutAdmin() {
    isAdminUnlocked = false;
    document.getElementById('admin-zone').style.display = 'none';
    document.getElementById('audit-tab-btn').style.display = 'none';
    document.getElementById('admin-login-box').style.display = 'block';
    document.getElementById('admin-login-step1').style.display = 'flex';
    document.getElementById('admin-login-step2').style.display = 'none';
    document.getElementById('admin-id').value = '';
    document.getElementById('admin-pass').value = '';
    document.getElementById('admin-otp').value = '';
    openTab({ currentTarget: document.querySelector('button[onclick*="settings-section"]') }, 'settings-section');
    alert("Logged out securely."); loadData(); 
}

async function requestOTP() {
    alert("Sending OTP to your email...");
    const res = await fetch(`${API_URL}/security/send-otp`, { method: 'POST' });
    const data = await res.json();
    alert(data.message || data.error);
}

async function executeReset() {
    const otp = document.getElementById('reset-otp').value.trim();
    const phrase = document.getElementById('reset-phrase').value.trim(); 
    if(!otp || !phrase) return alert("Fill out both OTP and Phrase.");
    const res = await fetch(`${API_URL}/security/reset-balances`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otp, phrase }) });
    const data = await res.json();
    if(res.ok) { alert("Success: " + data.message); document.getElementById('reset-otp').value = ''; document.getElementById('reset-phrase').value = ''; loadData(); } else { alert("Error: " + data.error); }
}

async function requestWipe() {
    if(confirm("Start the cooling period to wipe the entire database?")) {
        const res = await fetch(`${API_URL}/security/request-wipe`, { method: 'POST' });
        const data = await res.json();
        alert(data.message || data.error); loadData();
    }
}

async function executeWipe() {
    const otp = document.getElementById('wipe-otp').value.trim();
    const phrase = document.getElementById('wipe-phrase').value.trim();
    if(!otp || !phrase) return alert("Fill out both OTP and Phrase.");
    const res = await fetch(`${API_URL}/security/execute-wipe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otp, phrase }) });
    const data = await res.json();
    if(res.ok) { alert("Success: " + data.message); document.getElementById('wipe-otp').value = ''; document.getElementById('wipe-phrase').value = ''; loadData(); } else { alert("Error: " + data.error); }
}

document.getElementById('type').addEventListener('change', function(e) {
    const catSelect = document.getElementById('category');
    if (e.target.value === 'Receipt' || e.target.value === 'Contra') { catSelect.disabled = true; catSelect.required = false; catSelect.value = ''; } else { catSelect.disabled = false; catSelect.required = true; }
});

document.getElementById('edit-type').addEventListener('change', function(e) {
    const editCatSelect = document.getElementById('edit-category');
    if (e.target.value === 'Receipt' || e.target.value === 'Contra') { editCatSelect.disabled = true; editCatSelect.value = ''; } else { editCatSelect.disabled = false; }
});

loadData();