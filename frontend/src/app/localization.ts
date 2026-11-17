import { Injectable, signal } from '@angular/core';

export const ru = {
  Dashboard: 'Обзор',
  Accounts: 'Счета',
  Transactions: 'Операции',
  Budgets: 'Бюджеты',
  Reserves: 'Резервы',
  Reports: 'Отчёты',
  'Household settings': 'Настройки семьи',
  Categories: 'Категории',
  'Signed in': 'Вы вошли',
  Household: 'Семья',
  Profile: 'Профиль',
  'Sign out': 'Выйти',
  'Loading your workspace…': 'Загрузка рабочего пространства…',
  Retry: 'Повторить',
  'Reload page': 'Обновить страницу',
  'Sign-in is temporarily unavailable. Please try again.':
    'Вход временно недоступен. Попробуйте ещё раз.',
  'Try again': 'Попробовать снова',
  'Household invitation': 'Приглашение в семью',
  Dismiss: 'Закрыть',
  'A shared place for your household finances.': 'Общее пространство для финансов вашей семьи.',
  'You have an invitation. Sign in with the invited email address to review it.':
    'У вас есть приглашение. Войдите с адресом электронной почты, на который оно отправлено.',
  'Sign in': 'Войти',
  'Create account': 'Создать учётную запись',
  'Email address': 'Электронная почта',
  Password: 'Пароль',
  'Use 12 to 128 characters.': 'Используйте от 12 до 128 символов.',
  'Confirm password': 'Подтвердите пароль',
  'Signing in…': 'Вход…',
  'Creating account…': 'Создание учётной записи…',
  'Need an account? Create account': 'Нет учётной записи? Создать',
  'Already have an account? Sign in': 'Уже есть учётная запись? Войти',
  'Passwords do not match. Please check and try again.':
    'Пароли не совпадают. Проверьте их и попробуйте снова.',
  'Your household finances, in one place.': 'Финансы вашей семьи в одном месте.',
  'Add transaction': 'Добавить операцию',
  'Create your household': 'Создайте семью',
  'Create a household to start managing your finances together.':
    'Создайте семью, чтобы вместе управлять финансами.',
  'Create household': 'Создать семью',
  'Household balance': 'Баланс семьи',
  'No accounts or activity yet.': 'Пока нет счетов и операций.',
  'Income this month': 'Доходы за месяц',
  'Expenses this month': 'Расходы за месяц',
  'Get started': 'Начало работы',
  'Add an account to begin organizing your household finances.':
    'Добавьте счёт, чтобы начать вести семейные финансы.',
  'Go to accounts': 'Перейти к счетам',
  'Recent activity': 'Последние операции',
  'No transactions yet.': 'Пока нет операций.',
  'Household overview': 'Обзор семьи',
  'Account balances and history are available on Accounts. Consolidated dashboard figures and reports are coming soon.':
    'Балансы и история доступны в разделе «Счета». Общие показатели и отчёты скоро появятся.',
  'No accounts yet. Add an account when account management becomes available.':
    'Пока нет счетов. Добавьте счёт, когда управление счетами станет доступно.',
  'Add account': 'Добавить счёт',
  'Account management is coming soon.': 'Управление счетами скоро появится.',
  'Start by adding an account before recording transactions.':
    'Сначала добавьте счёт, чтобы записывать операции.',
  'No budget plans yet for this household.': 'Для этой семьи пока нет планов бюджета.',
  'Add budget': 'Добавить бюджет',
  'Budget management is coming soon.': 'Управление бюджетом скоро появится.',
  'Add an account to start planning reserves.': 'Добавьте счёт, чтобы планировать резервы.',
  'No reserves yet.': 'Пока нет резервов.',
  'Create reserve': 'Создать резерв',
  'Reserve management is coming soon.': 'Управление резервами скоро появится.',
  'No transactions yet. Reports will help you understand your activity once transactions are available.':
    'Пока нет операций. Когда они появятся, отчёты помогут проанализировать их.',
  Close: 'Закрыть',
  'Choose how to add a transaction. These options are coming soon.':
    'Выберите способ добавления операции. Эти возможности скоро появятся.',
  'Add an account before recording transactions.': 'Добавьте счёт, прежде чем записывать операции.',
  'Enter manually': 'Ввести вручную',
  'Paste SMS': 'Вставить SMS',
  'Upload image': 'Загрузить изображение',
  'Transaction entry and imports will be available in a future update.':
    'Ввод и импорт операций появятся в одном из следующих обновлений.',
  'Balances, owners, and available funds by account.':
    'Балансы, владельцы и доступные средства по счетам.',
  'Create a household first': 'Сначала создайте семью',
  'Accounts belong to a shared household.': 'Счета принадлежат общей семье.',
  'Go to household settings': 'Перейти к настройкам семьи',
  'Loading accounts…': 'Загрузка счетов…',
  'Household accounts': 'Счета семьи',
  'Everyone in the household can see all accounts. Ownership is for display.':
    'Все участники семьи видят все счета. Владелец указан для справки.',
  Status: 'Статус',
  'All accounts': 'Все счета',
  Active: 'Активные',
  Archived: 'Архивные',
  'No accounts yet. Add your first account to get started.':
    'Пока нет счетов. Добавьте первый счёт.',
  'No accounts match this status.': 'Нет счетов с таким статусом.',
  Balance: 'Баланс',
  Reserved: 'В резерве',
  Available: 'Доступно',
  'Close details': 'Закрыть сведения',
  'Edit account': 'Изменить счёт',
  'Archive account': 'Архивировать счёт',
  'Restore account': 'Восстановить счёт',
  'Archiving preserves the balance and history.': 'При архивировании баланс и история сохраняются.',
  History: 'История',
  'Loading history…': 'Загрузка истории…',
  'Retry history': 'Повторить загрузку истории',
  'No movements yet.': 'Пока нет движений.',
  'Load more history': 'Показать ещё',
  'Record a balance change': 'Записать изменение баланса',
  'Enter the change, not the resulting balance. Use + to increase or − to decrease the balance.':
    'Введите изменение, а не итоговый баланс. Используйте + для увеличения или − для уменьшения.',
  Date: 'Дата',
  'Saving…': 'Сохранение…',
  'Confirm balance change': 'Подтвердить изменение баланса',
  'Review change': 'Проверить изменение',
  'Add an account': 'Добавить счёт',
  'Update account details.': 'Измените данные счёта.',
  'Set the opening balance as of a date.': 'Укажите начальный баланс на определённую дату.',
  Name: 'Название',
  Type: 'Тип',
  Cash: 'Наличные',
  Bank: 'Банк',
  Card: 'Карта',
  Currency: 'Валюта',
  'Currency cannot change after the first transaction.':
    'После первой операции валюту изменить нельзя.',
  "Changing currency keeps the same amounts. Use this only to correct the account's currency.":
    'При изменении валюты суммы остаются прежними. Используйте это только для исправления валюты счёта.',
  Owner: 'Владелец',
  Designation: 'Назначение',
  Personal: 'Личный',
  Business: 'Деловой',
  'Opening balance': 'Начальный баланс',
  'As of date': 'На дату',
  'Cancel edit': 'Отменить редактирование',
  'Save changes': 'Сохранить изменения',
  "Organize your household's income and expenses.": 'Упорядочьте доходы и расходы семьи.',
  'Categories belong to a shared household.': 'Категории принадлежат общей семье.',
  "Archived categories remain in history and cannot be selected for new activity. A category's type is fixed when created.":
    'Архивные категории остаются в истории и недоступны для новых операций. Тип категории нельзя изменить после создания.',
  'Search categories': 'Поиск категорий',
  'All statuses': 'Все статусы',
  'Loading categories…': 'Загрузка категорий…',
  'No categories yet. Create one to get started.': 'Пока нет категорий. Создайте первую.',
  'Category name': 'Название категории',
  'Save name': 'Сохранить название',
  Cancel: 'Отмена',
  Rename: 'Переименовать',
  Expense: 'Расход',
  Income: 'Доход',
  'For expenses, fees, refunds and budgets': 'Для расходов, комиссий, возвратов и бюджетов',
  'For income': 'Для доходов',
  Archive: 'Архивировать',
  Restore: 'Восстановить',
  'Create a category': 'Создать категорию',
  'Choose a type for this category. You can rename or archive it later.':
    'Выберите тип категории. Позже её можно переименовать или архивировать.',
  'Create category': 'Создать категорию',
  'Need an idea? Select a suggested name to fill the form, then create it.':
    'Нужна идея? Выберите предложенное название и создайте категорию.',
  'Manage the people and details in your shared household.':
    'Управляйте участниками и данными семьи.',
  'Household details': 'Данные семьи',
  'Create a household': 'Создать семью',
  'The details shared by everyone in this household.': 'Данные, общие для всех участников семьи.',
  'Start a shared space for your household.': 'Создайте общее пространство для семьи.',
  'Household name': 'Название семьи',
  'Time zone': 'Часовой пояс',
  'Optional · IANA name, for example Europe/Belgrade':
    'Необязательно · Название IANA, например Europe/Belgrade',
  'Base currency:': 'Основная валюта:',
  'Base currency': 'Основная валюта',
  'Only the household owner can edit these details.':
    'Только владелец семьи может изменять эти данные.',
  'Manage the categories shared by this household.': 'Управление общими категориями семьи.',
  'Manage categories': 'Управление категориями',
  People: 'Участники',
  'A household can have up to two active or invited people.':
    'В семье может быть не более двух активных или приглашённых участников.',
  'Loading people…': 'Загрузка участников…',
  'No people to show yet.': 'Пока нет участников.',
  'Revoke access?': 'Отозвать доступ?',
  'Yes, revoke': 'Да, отозвать',
  Keep: 'Оставить',
  'Revoke access': 'Отозвать доступ',
  'Cancel invitation': 'Отменить приглашение',
  'People could not be loaded.': 'Не удалось загрузить участников.',
  'Invite a member': 'Пригласить участника',
  'Create a private link for the person you want to share this household with. They must sign in using the invited email address.':
    'Создайте личную ссылку для участника семьи. Ему нужно войти с адресом электронной почты, на который отправлено приглашение.',
  'Create invitation': 'Создать приглашение',
  'Invitation link': 'Ссылка приглашения',
  'Copy link': 'Копировать ссылку',
  'Share this link privately. It will not be shown again after you leave this page.':
    'Отправьте ссылку лично. Она больше не появится после ухода со страницы.',
  'No results match your filters.': 'Нет результатов по выбранным фильтрам.',
  'Reset filters': 'Сбросить фильтры',
  'No results yet.': 'Пока нет результатов.',
  Language: 'Язык',
  'This invitation link is invalid. Ask the owner for a new link.':
    'Ссылка приглашения недействительна. Попросите владельца создать новую.',
  'Your session has ended. Please sign in again.': 'Ваша сессия завершилась. Войдите снова.',
  'This household is no longer available. Your household list has been refreshed.':
    'Эта семья больше недоступна. Список семей обновлён.',
  'Something went wrong. Please try again.': 'Что-то пошло не так. Попробуйте ещё раз.',
  'Could not reach the server. Please check your connection and try again.':
    'Не удалось связаться с сервером. Проверьте подключение и попробуйте снова.',
  'Enter a name, a valid opening amount with at most two decimal places, and an opening date.':
    'Введите название, начальную сумму не более чем с двумя знаками после точки и дату.',
  'Choose an active owner or Household.': 'Выберите активного владельца или семью.',
  'Account updated.': 'Счёт обновлён.',
  'Account created.': 'Счёт создан.',
  'Account restored.': 'Счёт восстановлен.',
  'Account archived. Its history and balances are preserved.':
    'Счёт архивирован. История и балансы сохранены.',
  'Enter a nonzero signed change with at most two decimal places and a date.':
    'Введите ненулевое изменение со знаком и не более чем двумя знаками после точки, а также дату.',
  'Balance change recorded.': 'Изменение баланса записано.',
  'Former member': 'Бывший участник',
  'Household member': 'Участник семьи',
  'Enter a category name of 1 to 80 characters.':
    'Введите название категории длиной от 1 до 80 символов.',
  'Category created.': 'Категория создана.',
  'Category renamed.': 'Категория переименована.',
  'Category restored.': 'Категория восстановлена.',
  'Category archived.': 'Категория архивирована.',
  'Enter a household name.': 'Введите название семьи.',
  'Household settings saved.': 'Настройки семьи сохранены.',
  'Household created.': 'Семья создана.',
  'Enter a valid email address.': 'Введите корректный адрес электронной почты.',
  'Invitation created. Copy the link below; it will only be shown once.':
    'Приглашение создано. Скопируйте ссылку ниже: она показывается только один раз.',
  'Invitation link copied.': 'Ссылка приглашения скопирована.',
  'Could not copy automatically. Select and copy the link below.':
    'Не удалось скопировать автоматически. Выделите и скопируйте ссылку ниже.',
  'Member access revoked.': 'Доступ участника отозван.',
  'Invitation cancelled.': 'Приглашение отменено.',
  'Main navigation': 'Основная навигация',
  'You are signed in as {email}. Accept this invitation to join the household.':
    'Вы вошли как {email}. Примите приглашение, чтобы присоединиться к семье.',
  'Accepting…': 'Принятие…',
  'Accept invitation': 'Принять приглашение',
  'View {name}': 'Открыть {name}',
  'Rename {name}': 'Переименовать {name}',
  'Archive {name}': 'Архивировать {name}',
  'Restore {name}': 'Восстановить {name}',
  'Signed change ({currency})': 'Изменение со знаком ({currency})',
  'e.g. +10.00 or -10.00': 'например, +10.00 или -10.00',
  'Review: change {name} by {amount} {currency} on {date}. Confirm to record it.':
    'Проверьте: изменение счёта {name} на {amount} {currency} от {date}. Подтвердите запись.',
  inactive: 'неактивен',
  cash: 'наличные',
  bank: 'банк',
  card: 'карта',
  personal: 'личный',
  business: 'деловой',
  active: 'активный',
  archived: 'архивный',
  opening_balance: 'начальный баланс',
  adjustment: 'корректировка',
  transaction: 'операция',
  owner: 'владелец',
  member: 'участник',
  pending: 'ожидает',
  revoked: 'отозван',
  expired: 'истёк',
  accepted: 'принят',
  'Email unavailable': 'Адрес электронной почты недоступен',
  You: 'Вы',
  'Expires {date}': 'Истекает {date}',
  'Not used for transfers.': 'Не используется для переводов.',
  'Loading {page}…': 'Загрузка: {page}…',
  '{accounts} accounts · {transactions} transactions · {movements} account movements':
    'Счета: {accounts} · операции: {transactions} · движения по счетам: {movements}',
  '{count} saved accounts. Account details are coming soon.':
    'Сохранено счетов: {count}. Сведения о счетах скоро появятся.',
  '{count} saved transactions. Transaction details are coming soon.':
    'Сохранено операций: {count}. Сведения об операциях скоро появятся.',
  '{month} budget': 'Бюджет на {month}',
  '{count} saved plans. Budget details are coming soon.':
    'Сохранено планов: {count}. Сведения о бюджете скоро появятся.',
  '{count} saved reserves. Reserve details are coming soon.':
    'Сохранено резервов: {count}. Сведения о резервах скоро появятся.',
  '{count} saved transactions. Reports are coming soon.':
    'Сохранено операций: {count}. Отчёты скоро появятся.',
  'Invalid email or password.': 'Неверная электронная почта или пароль.',
  'This item has changed. Refresh and try again.':
    'Данные изменились. Обновите страницу и попробуйте снова.',
  'This invitation is invalid or has expired.':
    'Приглашение недействительно или срок его действия истёк.',
  'This household already has the maximum number of members.':
    'В семье уже максимальное число участников.',
  'You do not have permission to do this.': 'У вас нет прав для этого действия.',
  'Please check the entered information.': 'Проверьте введённые данные.',
  'Too many requests. Please try again later.': 'Слишком много запросов. Попробуйте позже.',
  'Create financial account': 'Создать счёт',
  Groceries: 'Продукты',
  Utilities: 'Коммунальные услуги',
  Transport: 'Транспорт',
  Salary: 'Зарплата',
  'Other income': 'Прочие доходы',
  'Use a dot as the decimal separator, for example 10.50.':
    'Используйте точку или запятую в качестве десятичного разделителя, например 10,50.',
  'Insufficient funds for this operation.': 'Недостаточно средств для этой операции.',
  'Currency cannot be changed after the first transaction.':
    'После первой операции валюту изменить нельзя.',
  'This account is unavailable or cannot be used for this operation.':
    'Счёт недоступен или не подходит для этой операции.',
  'Choose an eligible account owner.': 'Выберите подходящего владельца счёта.',
  'This category is unavailable or cannot be used for this operation.':
    'Категория недоступна или не подходит для этой операции.',
  "A category's type cannot be changed.": 'Тип категории нельзя изменить.',
  'This transaction is unavailable or linked to other activity.':
    'Операция недоступна или связана с другими данными.',
  'This request conflicts with an earlier request. Refresh and try again.':
    'Запрос конфликтует с предыдущим. Обновите страницу и попробуйте снова.',
  'The submitted data is too large.': 'Отправлено слишком много данных.',
  'This request could not be verified. Reload the page and try again.':
    'Не удалось проверить запрос. Обновите страницу и попробуйте снова.',
  'The service is temporarily unavailable. Please try again later.':
    'Сервис временно недоступен. Попробуйте позже.',
} as const;
export type Message = keyof typeof ru;
export const sr: Record<Message, string> = {
  Dashboard: 'Pregled',
  Accounts: 'Računi',
  Transactions: 'Transakcije',
  Budgets: 'Budžeti',
  Reserves: 'Rezerve',
  Reports: 'Izveštaji',
  'Household settings': 'Podešavanja domaćinstva',
  Categories: 'Kategorije',
  'Signed in': 'Prijavljeni ste',
  Household: 'Domaćinstvo',
  Profile: 'Profil',
  'Sign out': 'Odjavite se',
  'Loading your workspace…': 'Učitavanje radnog prostora…',
  Retry: 'Pokušaj ponovo',
  'Reload page': 'Ponovo učitaj stranicu',
  'Sign-in is temporarily unavailable. Please try again.':
    'Prijava trenutno nije dostupna. Pokušajte ponovo.',
  'Try again': 'Pokušaj ponovo',
  'Household invitation': 'Poziv u domaćinstvo',
  Dismiss: 'Zatvori',
  'A shared place for your household finances.': 'Zajedničko mesto za finansije vašeg domaćinstva.',
  'You have an invitation. Sign in with the invited email address to review it.':
    'Imate poziv. Prijavite se pozvanom adresom e-pošte da biste ga pregledali.',
  'Sign in': 'Prijavite se',
  'Create account': 'Napravite nalog',
  'Email address': 'Adresa e-pošte',
  Password: 'Lozinka',
  'Use 12 to 128 characters.': 'Koristite od 12 do 128 znakova.',
  'Confirm password': 'Potvrdite lozinku',
  'Signing in…': 'Prijavljivanje…',
  'Creating account…': 'Pravljenje naloga…',
  'Need an account? Create account': 'Nemate nalog? Napravite ga',
  'Already have an account? Sign in': 'Već imate nalog? Prijavite se',
  'Passwords do not match. Please check and try again.':
    'Lozinke se ne podudaraju. Proverite ih i pokušajte ponovo.',
  'Your household finances, in one place.': 'Finansije vašeg domaćinstva na jednom mestu.',
  'Add transaction': 'Dodaj transakciju',
  'Create your household': 'Napravite domaćinstvo',
  'Create a household to start managing your finances together.':
    'Napravite domaćinstvo da biste zajedno upravljali finansijama.',
  'Create household': 'Napravi domaćinstvo',
  'Household balance': 'Stanje domaćinstva',
  'No accounts or activity yet.': 'Još nema računa ni aktivnosti.',
  'Income this month': 'Prihodi ovog meseca',
  'Expenses this month': 'Rashodi ovog meseca',
  'Get started': 'Početak',
  'Add an account to begin organizing your household finances.':
    'Dodajte račun da biste počeli da uređujete finansije domaćinstva.',
  'Go to accounts': 'Idi na račune',
  'Recent activity': 'Nedavne aktivnosti',
  'No transactions yet.': 'Još nema transakcija.',
  'Household overview': 'Pregled domaćinstva',
  'Account balances and history are available on Accounts. Consolidated dashboard figures and reports are coming soon.':
    'Stanja i istorija računa dostupni su u odeljku Računi. Zbirni podaci i izveštaji uskoro stižu.',
  'No accounts yet. Add an account when account management becomes available.':
    'Još nema računa. Dodajte račun kada upravljanje računima bude dostupno.',
  'Add account': 'Dodaj račun',
  'Account management is coming soon.': 'Upravljanje računima uskoro stiže.',
  'Start by adding an account before recording transactions.':
    'Najpre dodajte račun pre beleženja transakcija.',
  'No budget plans yet for this household.': 'Još nema planova budžeta za ovo domaćinstvo.',
  'Add budget': 'Dodaj budžet',
  'Budget management is coming soon.': 'Upravljanje budžetom uskoro stiže.',
  'Add an account to start planning reserves.':
    'Dodajte račun da biste počeli da planirate rezerve.',
  'No reserves yet.': 'Još nema rezervi.',
  'Create reserve': 'Napravi rezervu',
  'Reserve management is coming soon.': 'Upravljanje rezervama uskoro stiže.',
  'No transactions yet. Reports will help you understand your activity once transactions are available.':
    'Još nema transakcija. Izveštaji će vam pomoći da razumete aktivnosti kada transakcije budu dostupne.',
  Close: 'Zatvori',
  'Choose how to add a transaction. These options are coming soon.':
    'Izaberite kako da dodate transakciju. Ove mogućnosti uskoro stižu.',
  'Add an account before recording transactions.': 'Dodajte račun pre beleženja transakcija.',
  'Enter manually': 'Unesi ručno',
  'Paste SMS': 'Nalepi SMS',
  'Upload image': 'Otpremi sliku',
  'Transaction entry and imports will be available in a future update.':
    'Unos i uvoz transakcija biće dostupni u narednom ažuriranju.',
  'Balances, owners, and available funds by account.':
    'Stanja, vlasnici i raspoloživa sredstva po računu.',
  'Create a household first': 'Najpre napravite domaćinstvo',
  'Accounts belong to a shared household.': 'Računi pripadaju zajedničkom domaćinstvu.',
  'Go to household settings': 'Idi na podešavanja domaćinstva',
  'Loading accounts…': 'Učitavanje računa…',
  'Household accounts': 'Računi domaćinstva',
  'Everyone in the household can see all accounts. Ownership is for display.':
    'Svi članovi domaćinstva mogu da vide sve račune. Vlasništvo je prikazano informativno.',
  Status: 'Status',
  'All accounts': 'Svi računi',
  Active: 'Aktivni',
  Archived: 'Arhivirani',
  'No accounts yet. Add your first account to get started.':
    'Još nema računa. Dodajte prvi račun za početak.',
  'No accounts match this status.': 'Nema računa sa ovim statusom.',
  Balance: 'Stanje',
  Reserved: 'Rezervisano',
  Available: 'Dostupno',
  'Close details': 'Zatvori detalje',
  'Edit account': 'Izmeni račun',
  'Archive account': 'Arhiviraj račun',
  'Restore account': 'Vrati račun',
  'Archiving preserves the balance and history.': 'Arhiviranje čuva stanje i istoriju.',
  History: 'Istorija',
  'Loading history…': 'Učitavanje istorije…',
  'Retry history': 'Pokušaj ponovo učitavanje istorije',
  'No movements yet.': 'Još nema promena.',
  'Load more history': 'Učitaj još istorije',
  'Record a balance change': 'Zabeleži promenu stanja',
  'Enter the change, not the resulting balance. Use + to increase or − to decrease the balance.':
    'Unesite promenu, a ne konačno stanje. Koristite + za povećanje ili − za smanjenje stanja.',
  Date: 'Datum',
  'Saving…': 'Čuvanje…',
  'Confirm balance change': 'Potvrdi promenu stanja',
  'Review change': 'Proveri promenu',
  'Add an account': 'Dodaj račun',
  'Update account details.': 'Izmenite podatke računa.',
  'Set the opening balance as of a date.': 'Postavite početno stanje na određeni datum.',
  Name: 'Naziv',
  Type: 'Vrsta',
  Cash: 'Gotovina',
  Bank: 'Banka',
  Card: 'Kartica',
  Currency: 'Valuta',
  'Currency cannot change after the first transaction.':
    'Valuta se ne može promeniti posle prve transakcije.',
  "Changing currency keeps the same amounts. Use this only to correct the account's currency.":
    'Promena valute zadržava iste iznose. Koristite je samo za ispravku valute računa.',
  Owner: 'Vlasnik',
  Designation: 'Namena',
  Personal: 'Lično',
  Business: 'Poslovno',
  'Opening balance': 'Početno stanje',
  'As of date': 'Na datum',
  'Cancel edit': 'Otkaži izmenu',
  'Save changes': 'Sačuvaj izmene',
  "Organize your household's income and expenses.": 'Uredite prihode i rashode domaćinstva.',
  'Categories belong to a shared household.': 'Kategorije pripadaju zajedničkom domaćinstvu.',
  "Archived categories remain in history and cannot be selected for new activity. A category's type is fixed when created.":
    'Arhivirane kategorije ostaju u istoriji i ne mogu se birati za nove aktivnosti. Vrsta kategorije se određuje pri kreiranju.',
  'Search categories': 'Pretraži kategorije',
  'All statuses': 'Svi statusi',
  'Loading categories…': 'Učitavanje kategorija…',
  'No categories yet. Create one to get started.':
    'Još nema kategorija. Napravite prvu za početak.',
  'Category name': 'Naziv kategorije',
  'Save name': 'Sačuvaj naziv',
  Cancel: 'Otkaži',
  Rename: 'Preimenuj',
  Expense: 'Rashod',
  Income: 'Prihod',
  'For expenses, fees, refunds and budgets': 'Za rashode, naknade, povraćaje i budžete',
  'For income': 'Za prihode',
  Archive: 'Arhiviraj',
  Restore: 'Vrati',
  'Create a category': 'Napravi kategoriju',
  'Choose a type for this category. You can rename or archive it later.':
    'Izaberite vrstu kategorije. Kasnije je možete preimenovati ili arhivirati.',
  'Create category': 'Napravi kategoriju',
  'Need an idea? Select a suggested name to fill the form, then create it.':
    'Treba vam ideja? Izaberite predloženi naziv, a zatim napravite kategoriju.',
  'Manage the people and details in your shared household.':
    'Upravljajte članovima i podacima zajedničkog domaćinstva.',
  'Household details': 'Podaci domaćinstva',
  'Create a household': 'Napravi domaćinstvo',
  'The details shared by everyone in this household.': 'Podaci koje dele svi članovi domaćinstva.',
  'Start a shared space for your household.': 'Napravite zajednički prostor za domaćinstvo.',
  'Household name': 'Naziv domaćinstva',
  'Time zone': 'Vremenska zona',
  'Optional · IANA name, for example Europe/Belgrade':
    'Opciono · IANA naziv, na primer Europe/Belgrade',
  'Base currency:': 'Osnovna valuta:',
  'Base currency': 'Osnovna valuta',
  'Only the household owner can edit these details.':
    'Samo vlasnik domaćinstva može da izmeni ove podatke.',
  'Manage the categories shared by this household.':
    'Upravljajte zajedničkim kategorijama domaćinstva.',
  'Manage categories': 'Upravljanje kategorijama',
  People: 'Članovi',
  'A household can have up to two active or invited people.':
    'Domaćinstvo može imati najviše dva aktivna ili pozvana člana.',
  'Loading people…': 'Učitavanje članova…',
  'No people to show yet.': 'Još nema članova za prikaz.',
  'Revoke access?': 'Opozvati pristup?',
  'Yes, revoke': 'Da, opozovi',
  Keep: 'Zadrži',
  'Revoke access': 'Opozovi pristup',
  'Cancel invitation': 'Otkaži poziv',
  'People could not be loaded.': 'Nije moguće učitati članove.',
  'Invite a member': 'Pozovi člana',
  'Create a private link for the person you want to share this household with. They must sign in using the invited email address.':
    'Napravite privatnu vezu za osobu sa kojom želite da delite domaćinstvo. Mora se prijaviti pozvanom adresom e-pošte.',
  'Create invitation': 'Napravi poziv',
  'Invitation link': 'Veza za poziv',
  'Copy link': 'Kopiraj vezu',
  'Share this link privately. It will not be shown again after you leave this page.':
    'Podelite ovu vezu privatno. Neće se ponovo prikazati kada napustite stranicu.',
  'No results match your filters.': 'Nema rezultata koji odgovaraju filterima.',
  'Reset filters': 'Resetuj filtere',
  'No results yet.': 'Još nema rezultata.',
  Language: 'Jezik',
  'This invitation link is invalid. Ask the owner for a new link.':
    'Veza za poziv nije ispravna. Zamolite vlasnika za novu vezu.',
  'Your session has ended. Please sign in again.': 'Vaša sesija je završena. Prijavite se ponovo.',
  'This household is no longer available. Your household list has been refreshed.':
    'Ovo domaćinstvo više nije dostupno. Spisak domaćinstava je osvežen.',
  'Something went wrong. Please try again.': 'Došlo je do greške. Pokušajte ponovo.',
  'Could not reach the server. Please check your connection and try again.':
    'Nije moguće povezati se sa serverom. Proverite vezu i pokušajte ponovo.',
  'Enter a name, a valid opening amount with at most two decimal places, and an opening date.':
    'Unesite naziv, ispravan početni iznos sa najviše dve decimale i početni datum.',
  'Choose an active owner or Household.': 'Izaberite aktivnog vlasnika ili domaćinstvo.',
  'Account updated.': 'Račun je ažuriran.',
  'Account created.': 'Račun je napravljen.',
  'Account restored.': 'Račun je vraćen.',
  'Account archived. Its history and balances are preserved.':
    'Račun je arhiviran. Istorija i stanja su sačuvani.',
  'Enter a nonzero signed change with at most two decimal places and a date.':
    'Unesite promenu različitu od nule sa predznakom, najviše dve decimale i datum.',
  'Balance change recorded.': 'Promena stanja je zabeležena.',
  'Former member': 'Bivši član',
  'Household member': 'Član domaćinstva',
  'Enter a category name of 1 to 80 characters.': 'Unesite naziv kategorije od 1 do 80 znakova.',
  'Category created.': 'Kategorija je napravljena.',
  'Category renamed.': 'Kategorija je preimenovana.',
  'Category restored.': 'Kategorija je vraćena.',
  'Category archived.': 'Kategorija je arhivirana.',
  'Enter a household name.': 'Unesite naziv domaćinstva.',
  'Household settings saved.': 'Podešavanja domaćinstva su sačuvana.',
  'Household created.': 'Domaćinstvo je napravljeno.',
  'Enter a valid email address.': 'Unesite ispravnu adresu e-pošte.',
  'Invitation created. Copy the link below; it will only be shown once.':
    'Poziv je napravljen. Kopirajte vezu ispod; biće prikazana samo jednom.',
  'Invitation link copied.': 'Veza za poziv je kopirana.',
  'Could not copy automatically. Select and copy the link below.':
    'Automatsko kopiranje nije uspelo. Izaberite i kopirajte vezu ispod.',
  'Member access revoked.': 'Pristup člana je opozvan.',
  'Invitation cancelled.': 'Poziv je otkazan.',
  'Main navigation': 'Glavna navigacija',
  'You are signed in as {email}. Accept this invitation to join the household.':
    'Prijavljeni ste kao {email}. Prihvatite ovaj poziv da biste se pridružili domaćinstvu.',
  'Accepting…': 'Prihvatanje…',
  'Accept invitation': 'Prihvati poziv',
  'View {name}': 'Prikaži {name}',
  'Rename {name}': 'Preimenuj {name}',
  'Archive {name}': 'Arhiviraj {name}',
  'Restore {name}': 'Vrati {name}',
  'Signed change ({currency})': 'Promena sa predznakom ({currency})',
  'e.g. +10.00 or -10.00': 'npr. +10.00 ili -10.00',
  'Review: change {name} by {amount} {currency} on {date}. Confirm to record it.':
    'Proverite: promena računa {name} za {amount} {currency} na datum {date}. Potvrdite da biste je zabeležili.',
  inactive: 'neaktivan',
  cash: 'gotovina',
  bank: 'banka',
  card: 'kartica',
  personal: 'lično',
  business: 'poslovno',
  active: 'aktivan',
  archived: 'arhiviran',
  opening_balance: 'početno stanje',
  adjustment: 'korekcija',
  transaction: 'transakcija',
  owner: 'vlasnik',
  member: 'član',
  pending: 'na čekanju',
  revoked: 'opozvan',
  expired: 'istekao',
  accepted: 'prihvaćen',
  'Email unavailable': 'Adresa e-pošte nije dostupna',
  You: 'Vi',
  'Expires {date}': 'Ističe {date}',
  'Not used for transfers.': 'Ne koristi se za transfere.',
  'Loading {page}…': 'Učitavanje: {page}…',
  '{accounts} accounts · {transactions} transactions · {movements} account movements':
    'Računi: {accounts} · transakcije: {transactions} · promene na računima: {movements}',
  '{count} saved accounts. Account details are coming soon.':
    'Sačuvano računa: {count}. Detalji računa uskoro stižu.',
  '{count} saved transactions. Transaction details are coming soon.':
    'Sačuvano transakcija: {count}. Detalji transakcija uskoro stižu.',
  '{month} budget': 'Budžet za {month}',
  '{count} saved plans. Budget details are coming soon.':
    'Sačuvano planova: {count}. Detalji budžeta uskoro stižu.',
  '{count} saved reserves. Reserve details are coming soon.':
    'Sačuvano rezervi: {count}. Detalji rezervi uskoro stižu.',
  '{count} saved transactions. Reports are coming soon.':
    'Sačuvano transakcija: {count}. Izveštaji uskoro stižu.',
  'Invalid email or password.': 'Neispravna adresa e-pošte ili lozinka.',
  'This item has changed. Refresh and try again.':
    'Podaci su promenjeni. Osvežite stranicu i pokušajte ponovo.',
  'This invitation is invalid or has expired.': 'Ovaj poziv nije ispravan ili je istekao.',
  'This household already has the maximum number of members.':
    'Domaćinstvo već ima maksimalan broj članova.',
  'You do not have permission to do this.': 'Nemate dozvolu za ovu radnju.',
  'Please check the entered information.': 'Proverite unete podatke.',
  'Too many requests. Please try again later.': 'Previše zahteva. Pokušajte ponovo kasnije.',
  'Create financial account': 'Napravi račun',
  Groceries: 'Namirnice',
  Utilities: 'Komunalije',
  Transport: 'Prevoz',
  Salary: 'Plata',
  'Other income': 'Ostali prihodi',
  'Use a dot as the decimal separator, for example 10.50.':
    'Koristite tačku ili zarez kao decimalni separator, na primer 10,50.',
  'Insufficient funds for this operation.': 'Nema dovoljno sredstava za ovu operaciju.',
  'Currency cannot be changed after the first transaction.':
    'Valuta se ne može promeniti posle prve transakcije.',
  'This account is unavailable or cannot be used for this operation.':
    'Ovaj račun nije dostupan ili se ne može koristiti za ovu operaciju.',
  'Choose an eligible account owner.': 'Izaberite odgovarajućeg vlasnika računa.',
  'This category is unavailable or cannot be used for this operation.':
    'Ova kategorija nije dostupna ili se ne može koristiti za ovu operaciju.',
  "A category's type cannot be changed.": 'Vrsta kategorije se ne može promeniti.',
  'This transaction is unavailable or linked to other activity.':
    'Ova transakcija nije dostupna ili je povezana sa drugim aktivnostima.',
  'This request conflicts with an earlier request. Refresh and try again.':
    'Ovaj zahtev je u sukobu sa prethodnim. Osvežite stranicu i pokušajte ponovo.',
  'The submitted data is too large.': 'Poslati podaci su preveliki.',
  'This request could not be verified. Reload the page and try again.':
    'Zahtev nije moguće proveriti. Ponovo učitajte stranicu i pokušajte ponovo.',
  'The service is temporarily unavailable. Please try again later.':
    'Usluga trenutno nije dostupna. Pokušajte ponovo kasnije.',
};
export type Language = 'en' | 'ru' | 'sr';
@Injectable({ providedIn: 'root' })
export class Localization {
  readonly language = signal<Language>(this.initial());
  readonly locale = () => ({ en: 'en-US', ru: 'ru-RU', sr: 'sr-Latn-RS' })[this.language()];
  private initial(): Language {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('family-finance-language');
    } catch {
      /* Storage can be blocked. */
    }
    if (saved === 'en' || saved === 'ru' || saved === 'sr') return saved;
    const browser = typeof navigator === 'undefined' ? '' : navigator.language.toLowerCase();
    return browser.startsWith('ru') ? 'ru' : browser.startsWith('sr') ? 'sr' : 'en';
  }
  set(language: Language): void {
    if (!['en', 'ru', 'sr'].includes(language)) return;
    this.language.set(language);
    try {
      localStorage.setItem('family-finance-language', language);
    } catch {
      /* Preference is optional. */
    }
  }
  t(message: string, params: Record<string, string | number> = {}): string {
    const language = this.language();
    const catalog: Record<string, string> =
      language === 'ru'
        ? ru
        : language === 'sr'
          ? sr
          : { 'Create financial account': 'Create account' };
    return (catalog[message] ?? message).replace(/\{(\w+)\}/g, (match, key: string) =>
      String(params[key] ?? match),
    );
  }
}
