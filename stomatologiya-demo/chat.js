(function () {
  // Адрес Cloudflare Worker: он хранит ключ и передаёт вопрос нейросети
  var API = 'https://demo-stomatologiya-chat.kalammama63.workers.dev';
  var STORE = 'ulybka_demo_booking';

  // Намерения пациента: записаться / отменить / перенести / посмотреть свою запись
  var WANT_BOOK = /запис(ать|аться|ывайте|аться бы|ь меня)|запиши|хочу на при[её]м|на консультац\w* (хочу|можно)|как попасть|когда можно прийти|свободн\w* (время|окн)/i;
  var WANT_CANCEL = /отмен|не смогу прийти|не приду|не получится прийти/i;
  var WANT_MOVE = /перенес|перенос|другое время|другой день|поменять (время|день)|сдвинуть/i;
  var WANT_MY = /моя запись|когда я записан|на когда (я )?записан|мою запись/i;

  var CLINIC = { name: 'Улыбка Плюс', address: 'ул. Садовая, 12, 2 этаж', phone: '+7 (900) 000-00-00' };

  var SERVICES = [
    { id: 'consult', title: 'Консультация и осмотр', price: 'бесплатно', doctor: 'Анна Сергеевна Миронова', min: 30, kw: /консульт|осмотр/i },
    { id: 'pain', title: 'Острая боль', price: 'по плану лечения', doctor: 'Анна Сергеевна Миронова', min: 60, kw: /бол[ьи]т|остр|ноет|флюс|отек|отёк/i },
    { id: 'hyg', title: 'Профессиональная гигиена', price: '4 500 ₽', doctor: 'Анна Сергеевна Миронова', min: 60, kw: /чистк|гигиен|камн|налёт|налет|air ?flow/i },
    { id: 'caries', title: 'Лечение кариеса', price: 'от 4 000 ₽', doctor: 'Анна Сергеевна Миронова', min: 60, kw: /кари|пломб/i },
    { id: 'canal', title: 'Лечение каналов', price: 'от 9 000 ₽', doctor: 'Анна Сергеевна Миронова', min: 90, kw: /канал|пульпит|нерв/i },
    { id: 'extr', title: 'Удаление зуба', price: 'от 2 500 ₽', doctor: 'Дмитрий Олегович Ким', min: 60, kw: /удал|мудр/i },
    { id: 'impl', title: 'Консультация имплантолога', price: 'бесплатно', doctor: 'Дмитрий Олегович Ким', min: 30, kw: /имплант/i },
    { id: 'orto', title: 'Консультация ортодонта', price: '1 000 ₽', doctor: 'Елена Викторовна Белова', min: 30, kw: /брекет|элайнер|ортодонт|прикус|кривы/i },
    { id: 'white', title: 'Отбеливание ZOOM', price: '18 000 ₽', doctor: 'Анна Сергеевна Миронова', min: 90, kw: /отбел|zoom|белые зубы/i },
    { id: 'kids', title: 'Детский приём', price: 'от 2 500 ₽', doctor: 'Ольга Павловна Савина', min: 30, kw: /ребен|ребён|дет|сын|дочь|дочк|малыш/i },
    { id: 'crown', title: 'Коронки и виниры', price: 'от 18 000 ₽', doctor: 'Анна Сергеевна Миронова', min: 30, kw: /коронк|винир|протез/i }
  ];

  var WEEKDAY_SLOTS = ['09:00', '10:00', '11:30', '13:00', '14:30', '16:00', '17:30', '19:00'];
  var SATURDAY_SLOTS = ['10:00', '11:30', '13:00', '14:30'];
  var DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  var DOW_FULL = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];
  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  var chat = document.getElementById('chat');
  var body = document.getElementById('chat-body');
  var form = document.getElementById('chat-form');
  var input = document.getElementById('chat-input');
  var send = document.getElementById('chat-send');
  var chipMy = document.getElementById('chip-my');

  var history = [];
  var busy = false;
  var started = false;

  // ---------- хранение записи (в демо — в этом браузере) ----------
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; }
  }
  function save(b) {
    try { b ? localStorage.setItem(STORE, JSON.stringify(b)) : localStorage.removeItem(STORE); } catch (e) {}
    chipMy.hidden = !b;
  }
  var booking = load();
  if (booking && new Date(booking.date + 'T' + booking.time) < new Date()) { booking = null; save(null); }
  chipMy.hidden = !booking;

  // ---------- даты и слоты ----------
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fromYmd(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function human(dateStr, time) {
    var d = fromYmd(dateStr);
    return DOW_FULL[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ', в ' + time;
  }
  function humanShort(dateStr, time) {
    var d = fromYmd(dateStr);
    return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ', ' + time;
  }
  function workDays(n) {
    var out = [], d = new Date();
    d.setHours(0, 0, 0, 0);
    while (out.length < n) {
      if (d.getDay() !== 0 && slotsFor(d).some(function (t) { return free(d, t); })) out.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  function slotsFor(d) { return d.getDay() === 6 ? SATURDAY_SLOTS : d.getDay() === 0 ? [] : WEEKDAY_SLOTS; }
  // «Занятость» врача: стабильная для каждой даты, чтобы расписание выглядело живым
  function busySlot(dateStr, t) {
    var s = dateStr + t, h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 100 < 38;
  }
  function free(d, t) {
    var ds = ymd(d);
    var dt = new Date(ds + 'T' + t);
    if (dt.getTime() < Date.now() + 60 * 60 * 1000) return false; // не раньше чем через час
    if (booking && booking.date === ds && booking.time === t) return false;
    return !busySlot(ds, t);
  }

  // ---------- общий вывод ----------
  function scroll() { body.scrollTop = body.scrollHeight; }
  // показать элемент с его начала (длинная форма или подтверждение не должны обрезаться сверху)
  function scrollTo(node) { body.scrollTop = Math.max(0, node.offsetTop - body.offsetTop - 12); }
  function add(role, text) {
    var el = document.createElement('div');
    el.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
    el.textContent = text;
    body.appendChild(el);
    scroll();
    return el;
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function svc(id) { return SERVICES.filter(function (s) { return s.id === id; })[0] || SERVICES[0]; }
  function guessService() {
    var text = history.filter(function (h) { return h.role === 'user'; }).slice(-4).map(function (h) { return h.text; }).join(' ');
    for (var i = SERVICES.length - 1; i >= 0; i--) if (SERVICES[i].kw.test(text)) return SERVICES[i].id;
    return 'consult';
  }
  function remember(role, text) { history.push({ role: role, text: text }); }

  function clinicCard(title, lines) {
    var c = el('div', 'lead-card');
    c.appendChild(el('b', null, '🔔 ' + esc(title)));
    var t = el('div');
    t.style.whiteSpace = 'pre-wrap';
    t.textContent = lines.join('\n');
    c.appendChild(t);
    body.appendChild(c);
    scroll();
  }

  // ---------- форма записи ----------
  function showBookingForm(mode) {
    var old = booking;
    var card = el('div', 'book');
    var titleText = mode === 'move' ? 'Перенос записи' : 'Запись на приём';
    card.innerHTML =
      '<h4>' + titleText + '<small>' + (mode === 'move' ? 'выберите новое время' : 'онлайн, за 1 минуту') + '</small></h4>' +
      '<div><label>Услуга</label><select class="f-svc"></select><div class="doc-line"></div></div>' +
      '<div><label>День</label><div class="days"></div></div>' +
      '<div><label>Время</label><div class="slots"></div></div>' +
      '<div class="two"><div><label>Имя</label><input class="f-name" placeholder="Как к вам обращаться" maxlength="40"></div>' +
      '<div><label>Телефон</label><input class="f-phone" type="tel" placeholder="+7 900 123-45-67" maxlength="18"></div></div>' +
      '<div class="err"></div>' +
      '<button type="button" class="go" disabled>' + (mode === 'move' ? 'Перенести запись' : 'Записаться') + '</button>' +
      '<div class="hint">Нажимая кнопку, вы соглашаетесь на обработку персональных данных</div>';

    var sel = card.querySelector('.f-svc');
    SERVICES.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.title + ' — ' + s.price;
      sel.appendChild(o);
    });
    sel.value = mode === 'move' && old ? old.service : guessService();
    var docLine = card.querySelector('.doc-line');
    function updDoc() { docLine.textContent = 'Врач: ' + svc(sel.value).doctor + ' · приём ~' + svc(sel.value).min + ' мин'; }
    sel.addEventListener('change', updDoc);
    updDoc();

    var nameIn = card.querySelector('.f-name');
    var phoneIn = card.querySelector('.f-phone');
    if (old) { nameIn.value = old.name; phoneIn.value = old.phone; }

    var chosenDate = null, chosenTime = null;
    var daysBox = card.querySelector('.days');
    var slotsBox = card.querySelector('.slots');
    var go = card.querySelector('.go');
    var err = card.querySelector('.err');

    function renderSlots() {
      slotsBox.innerHTML = '';
      var d = fromYmd(chosenDate);
      var any = false;
      slotsFor(d).forEach(function (t) {
        var b = el('button', null, t);
        b.type = 'button';
        if (!free(d, t)) { b.disabled = true; b.title = 'Занято'; } else any = true;
        if (t === chosenTime) b.classList.add('on');
        b.addEventListener('click', function () {
          chosenTime = t;
          slotsBox.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
          check();
        });
        slotsBox.appendChild(b);
      });
      if (!any) slotsBox.appendChild(el('div', 'empty', 'На этот день всё занято, выберите другой.'));
    }
    workDays(7).forEach(function (d, i) {
      var ds = ymd(d);
      var today = ymd(new Date()) === ds;
      var b = el('button', null, (today ? 'Сегодня' : DOW[d.getDay()]) + '<small>' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + '</small>');
      b.type = 'button';
      b.addEventListener('click', function () {
        chosenDate = ds;
        chosenTime = null;
        daysBox.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        renderSlots();
        check();
      });
      daysBox.appendChild(b);
      if (i === 0) { chosenDate = ds; b.classList.add('on'); }
    });
    renderSlots();

    // маска телефона: +7 900 123-45-67
    phoneIn.addEventListener('input', function () {
      var dgt = phoneIn.value.replace(/\D/g, '');
      if (dgt[0] === '8') dgt = '7' + dgt.slice(1);
      if (dgt && dgt[0] !== '7') dgt = '7' + dgt;
      dgt = dgt.slice(0, 11);
      var r = dgt ? '+7' : '';
      if (dgt.length > 1) r += ' ' + dgt.slice(1, 4);
      if (dgt.length > 4) r += ' ' + dgt.slice(4, 7);
      if (dgt.length > 7) r += '-' + dgt.slice(7, 9);
      if (dgt.length > 9) r += '-' + dgt.slice(9, 11);
      phoneIn.value = r;
      phoneIn.classList.remove('bad');
      check();
    });
    nameIn.addEventListener('input', check);

    function phoneOk() { return phoneIn.value.replace(/\D/g, '').length === 11; }
    function check() {
      go.disabled = !(chosenDate && chosenTime && nameIn.value.trim().length >= 2 && phoneOk());
      err.textContent = '';
    }
    phoneIn.addEventListener('blur', function () { if (phoneIn.value && !phoneOk()) phoneIn.classList.add('bad'); });

    go.addEventListener('click', function () {
      if (go.disabled) return;
      var d = fromYmd(chosenDate);
      if (!free(d, chosenTime)) { err.textContent = 'Это время только что заняли, выберите другое.'; renderSlots(); return; }
      go.disabled = true;
      go.textContent = 'Записываем…';
      setTimeout(function () {
        card.remove();
        var nb = {
          name: nameIn.value.trim(), phone: phoneIn.value, service: sel.value,
          date: chosenDate, time: chosenTime, id: 'U-' + String(Math.floor(1000 + Math.random() * 9000))
        };
        if (mode === 'move' && old) nb.id = old.id;
        booking = nb;
        save(booking);
        confirmBooking(mode === 'move' ? old : null);
      }, 900);
    });

    body.appendChild(card);
    scrollTo(card);
  }

  function bookingCard(b, title) {
    var s = svc(b.service);
    var c = el('div', 'done');
    c.innerHTML =
      '<b class="t">' + esc(title) + '</b>' +
      '<div class="row"><span>Когда</span><span>' + esc(human(b.date, b.time)) + '</span></div>' +
      '<div class="row"><span>Услуга</span><span>' + esc(s.title) + ' (' + esc(s.price) + ')</span></div>' +
      '<div class="row"><span>Врач</span><span>' + esc(s.doctor) + '</span></div>' +
      '<div class="row"><span>Адрес</span><span>' + esc(CLINIC.address) + '</span></div>' +
      '<div class="row"><span>Номер</span><span>' + esc(b.id) + '</span></div>' +
      '<div class="acts"><button type="button" class="mv">Перенести</button><button type="button" class="red cx">Отменить</button></div>';
    c.querySelector('.mv').addEventListener('click', function () { startMove(); });
    c.querySelector('.cx').addEventListener('click', function () { startCancel(); });
    body.appendChild(c);
    scroll();
  }

  function confirmBooking(oldBooking) {
    var b = booking, s = svc(b.service);
    var text = oldBooking
      ? 'Готово! Запись перенесена на ' + human(b.date, b.time) + '. За 2 часа до визита придёт напоминание.'
      : 'Готово, ' + b.name + '! Вы записаны на ' + human(b.date, b.time) + '. В день визита за 2 часа придёт напоминание.';
    var head = add('bot', text);
    remember('assistant', text);
    bookingCard(b, oldBooking ? '✅ Запись перенесена' : '✅ Вы записаны');

    var start = new Date(b.date + 'T' + b.time);
    var rem = new Date(start.getTime() - 2 * 60 * 60 * 1000);
    var r = el('div', 'remind');
    r.innerHTML = '<b>📱 Так придёт напоминание ' + rem.getDate() + ' ' + MONTHS[rem.getMonth()] + ' в ' +
      String(rem.getHours()).padStart(2, '0') + ':' + String(rem.getMinutes()).padStart(2, '0') + ' (SMS / WhatsApp / Telegram):</b>';
    var rt = el('div');
    rt.textContent = b.name + ', напоминаем: сегодня в ' + b.time + ' вас ждут в стоматологии «' + CLINIC.name + '», ' +
      CLINIC.address + '. Врач: ' + s.doctor + '. Если планы изменились, ответьте «перенести» или «отменить».';
    r.appendChild(rt);
    body.appendChild(r);

    clinicCard(oldBooking ? 'Так клиника узнает о переносе (Telegram):' : 'Так запись получит клиника (Telegram):', oldBooking ? [
      '🔁 Перенос записи ' + b.id,
      b.name + ', ' + b.phone,
      'Было: ' + humanShort(oldBooking.date, oldBooking.time),
      'Стало: ' + humanShort(b.date, b.time),
      s.title + ' · ' + s.doctor
    ] : [
      '🆕 Новая запись ' + b.id,
      b.name + ', ' + b.phone,
      humanShort(b.date, b.time) + ' · ' + s.title,
      'Врач: ' + s.doctor,
      lastQuestions()
    ].filter(Boolean));
    scrollTo(head);
  }

  function lastQuestions() {
    var q = history.filter(function (h) { return h.role === 'user' && !WANT_BOOK.test(h.text); }).slice(-2).map(function (h) { return h.text; });
    return q.length ? 'Спрашивал(а) в чате: ' + q.join(' / ') : '';
  }

  function noBooking() {
    var t = 'Не вижу у вас активной записи. Если записывались по телефону, позвоните нам: ' + CLINIC.phone + '. Или запишитесь прямо здесь:';
    add('bot', t);
    remember('assistant', t);
    showBookingForm('new');
  }

  function startMove() {
    if (!booking) return noBooking();
    var t = 'Конечно, перенесём. Выберите новое удобное время:';
    add('bot', t);
    remember('assistant', t);
    showBookingForm('move');
  }

  function startCancel() {
    if (!booking) return noBooking();
    var t = 'Отменить запись на ' + human(booking.date, booking.time) + '? Может быть, удобнее перенести на другое время?';
    add('bot', t);
    remember('assistant', t);
    var box = el('div', 'confirm');
    var bMove = el('button', null, 'Перенести');
    var bCancel = el('button', 'red', 'Да, отменить');
    bMove.type = bCancel.type = 'button';
    bMove.addEventListener('click', function () { box.remove(); add('user', 'Перенести'); remember('user', 'Перенести'); startMove(); });
    bCancel.addEventListener('click', function () {
      box.remove();
      add('user', 'Да, отменить');
      remember('user', 'Да, отменить');
      var old = booking;
      booking = null;
      save(null);
      var c = el('div', 'done cancelled');
      c.innerHTML = '<b class="t">Запись отменена</b><div class="row"><span>Была</span><span>' + esc(human(old.date, old.time)) + '</span></div>';
      body.appendChild(c);
      var tt = 'Запись отменена, время освободилось для других пациентов. Будем рады видеть вас, когда будет удобно!';
      add('bot', tt);
      remember('assistant', tt);
      clinicCard('Так клиника узнает об отмене (Telegram):', [
        '❌ Отмена записи ' + old.id,
        old.name + ', ' + old.phone,
        humanShort(old.date, old.time) + ' · ' + svc(old.service).title,
        'Время освободилось'
      ]);
    });
    box.appendChild(bMove);
    box.appendChild(bCancel);
    body.appendChild(box);
    scroll();
  }

  function showMy() {
    if (!booking) return noBooking();
    var t = 'Ваша запись:';
    add('bot', t);
    remember('assistant', t);
    bookingCard(booking, '📅 Вы записаны');
  }

  // ---------- открытие чата ----------
  function open() {
    chat.classList.add('open');
    if (!started) {
      started = true;
      if (booking) {
        add('bot', 'Здравствуйте, ' + booking.name + '! У вас запись на ' + human(booking.date, booking.time) + '. Хотите перенести или отменить, или есть вопрос?');
        bookingCard(booking, '📅 Вы записаны');
      } else {
        add('bot', 'Здравствуйте! Я онлайн-консультант стоматологии «' + CLINIC.name + '». Подскажу цены, расскажу про лечение и запишу на удобное время. Что вас интересует?');
      }
    }
    setTimeout(function () { input.focus(); }, 50);
  }

  function book() {
    open();
    if (busy) return;
    add('user', 'Записаться');
    remember('user', 'Записаться');
    if (booking) {
      var t = 'У вас уже есть запись на ' + human(booking.date, booking.time) + '. Перенести её или записаться ещё на одну услугу?';
      add('bot', t);
      remember('assistant', t);
      bookingCard(booking, '📅 Вы записаны');
      return;
    }
    var t2 = 'Выберите услугу, день и свободное время:';
    add('bot', t2);
    remember('assistant', t2);
    showBookingForm('new');
  }

  // ---------- вопрос консультанту (ИИ) ----------
  function ask(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    open();
    add('user', text);
    remember('user', text);

    // Запись, перенос, отмена — без ИИ, сразу кнопками
    if (WANT_CANCEL.test(text)) return startCancel();
    if (WANT_MOVE.test(text)) return startMove();
    if (WANT_MY.test(text)) return showMy();
    if (WANT_BOOK.test(text)) {
      var t = 'Выберите услугу, день и свободное время:';
      add('bot', t);
      remember('assistant', t);
      return showBookingForm('new');
    }

    busy = true;
    send.disabled = true;
    var typing = el('div', 'typing', '<i></i><i></i><i></i> печатает…');
    body.appendChild(typing);
    scroll();

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: history.slice(-10), ready: false })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var reply = d && d.reply ? d.reply : 'Извините, сейчас не получилось ответить. Позвоните нам: ' + CLINIC.phone + '.';
        add('bot', reply);
        remember('assistant', reply);
      })
      .catch(function () {
        add('bot', 'Извините, связь прервалась. Попробуйте ещё раз или позвоните: ' + CLINIC.phone + '.');
      })
      .finally(function () {
        typing.remove();
        busy = false;
        send.disabled = false;
        input.focus();
      });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var t = input.value;
    input.value = '';
    ask(t);
  });
  document.getElementById('chat-close').addEventListener('click', function () { chat.classList.remove('open'); });
  document.querySelectorAll('[data-open-chat]').forEach(function (b) { b.addEventListener('click', open); });
  document.querySelectorAll('[data-book]').forEach(function (b) { b.addEventListener('click', book); });
  document.querySelectorAll('[data-my]').forEach(function (b) { b.addEventListener('click', function () { open(); add('user', 'Моя запись'); remember('user', 'Моя запись'); showMy(); }); });
  document.querySelectorAll('[data-ask]').forEach(function (b) {
    b.addEventListener('click', function () { ask(b.getAttribute('data-ask')); });
  });
})();
