/**
 * Nang cao cac form cap nhat nhanh trong bang (form.js-inline-form): gui bang fetch()
 * thay vi submit thuong, tranh reload ca trang (giu nguyen vi tri cuon). Neu fetch loi
 * vi ly do gi do, tu dong quay lai submit thuong (form.submit()) de khong bi ket.
 */
(function () {
  function toUrlEncoded(form) {
    const params = new URLSearchParams();
    new FormData(form).forEach((value, key) => params.append(key, value));
    return params;
  }

  function setPhatBadge(btn, giaTriInput, trangThai, daPhat, soLuong) {
    const daPhatDu = trangThai === 'da_phat_du';
    const motPhan = trangThai === 'mot_phan';
    btn.className = 'badge ' + (daPhatDu ? 'badge--success' : motPhan ? 'badge--warn' : 'badge--gray');
    btn.textContent = daPhatDu ? 'Đã phát' : motPhan ? daPhat + '/' + soLuong : 'Chưa phát';
    giaTriInput.value = daPhatDu ? '0' : '1';
  }

  function setToggleBadge(btn, giaTriInput, nowOn) {
    btn.className = 'badge ' + (nowOn ? 'badge--success' : 'badge--gray');
    btn.textContent = nowOn ? 'Có' : 'Không';
    giaTriInput.value = nowOn ? '0' : '1';
  }

  function flashSaved(btn) {
    if (!btn) return;
    const original = btn.textContent;
    btn.textContent = '✔';
    setTimeout(() => {
      btn.textContent = original;
    }, 900);
  }

  async function handleSubmit(e) {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || !form.classList.contains('js-inline-form')) return;
    e.preventDefault();

    const hanhDongField = form.querySelector('[name="hanhDong"]');
    const giaTriInput = form.querySelector('[name="giaTri"]');
    const hanhDong = hanhDongField ? hanhDongField.value : '';
    const btn = form.querySelector('button[type="submit"], button:not([type])');
    if (btn) btn.disabled = true;

    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' },
        body: toUrlEncoded(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.message) alert(data.message);
        else form.submit();
        return;
      }
      const data = await res.json();
      if (!data.ok) {
        if (data.message) alert(data.message);
        return;
      }

      if (hanhDong === 'toggle_phat' && btn && giaTriInput) {
        setPhatBadge(btn, giaTriInput, data.trangThai, data.daPhat, data.soLuong);
      } else if ((hanhDong === 'toggle_the' || hanhDong === 'toggle_day') && btn && giaTriInput) {
        // Gia tri VUA gui len chinh la trang thai MOI (server da luu dung nhu vay).
        const submittedValue = giaTriInput.dataset.submitted === '1';
        setToggleBadge(btn, giaTriInput, submittedValue);
      } else if (hanhDong === 'set_size') {
        flashSaved(btn);
      }
      // set_trang_thai: select da tu hien thi gia tri moi, khong can cap nhat gi them.
    } catch (err) {
      form.submit();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // Ghi nho gia tri VUA gui truoc khi submit (vi sau khi cap nhat DOM, giaTriInput.value
  // se doi thanh gia tri KE TIEP, can biet gia tri cua lan gui nay de suy ra trang thai moi).
  document.addEventListener(
    'submit',
    (e) => {
      const form = e.target;
      if (form instanceof HTMLFormElement && form.classList.contains('js-inline-form')) {
        const giaTriInput = form.querySelector('[name="giaTri"]');
        if (giaTriInput) giaTriInput.dataset.submitted = giaTriInput.value;
      }
    },
    true
  );

  document.addEventListener('submit', handleSubmit);

  // Cac select co class "js-auto-submit" tu gui form khi doi gia tri (thay cho onchange=""
  // inline - bi CSP script-src-attr chan).
  document.addEventListener('change', (e) => {
    if (e.target instanceof HTMLSelectElement && e.target.classList.contains('js-auto-submit')) {
      e.target.form.requestSubmit();
    }
  });

  // Form co class "js-confirm" se hoi xac nhan truoc khi gui (thay cho onsubmit="confirm(...)"
  // inline - bi CSP script-src-attr chan). Noi dung hoi lay tu data-confirm-message.
  document.addEventListener(
    'submit',
    (e) => {
      const form = e.target;
      if (form instanceof HTMLFormElement && form.classList.contains('js-confirm')) {
        const message = form.dataset.confirmMessage || 'Bạn có chắc chắn?';
        if (!window.confirm(message)) e.preventDefault();
      }
    },
    true
  );
})();

/**
 * Thu gon/mo rong thanh menu ben trai, nho trang thai qua cac trang (localStorage) de
 * khong bi mo rong lai moi lan chuyen trang. Dat script ngay sau <aside id="sidebar"> trong
 * adminNav.ejs nen luc script nay chay, sidebar da co san trong DOM (khong can doi DOMContentLoaded),
 * giup ap dung trang thai thu gon truoc khi phan noi dung con lai cua trang duoc ve ra.
 */
(function () {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebarToggle');
  if (!sidebar || !toggleBtn) return;

  try {
    if (localStorage.getItem('sidebarCollapsed') === '1') {
      sidebar.classList.add('is-collapsed');
    }
  } catch (err) {
    /* localStorage khong dung duoc (che do rieng tu...) - bo qua, mac dinh mo rong. */
  }

  toggleBtn.addEventListener('click', () => {
    const collapsed = sidebar.classList.toggle('is-collapsed');
    try {
      localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
    } catch (err) {
      /* bo qua neu khong luu duoc */
    }
  });
})();
