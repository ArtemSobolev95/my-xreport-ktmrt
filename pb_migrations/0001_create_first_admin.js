/// <reference path="../pb_data/types.d.ts" />
// Раньше здесь были захардкожены реальные email/пароль администратора
// прямо в коде миграции — то есть в открытом виде в git-истории.
// Теперь эти значения читаются из переменных окружения; если они не заданы,
// миграция просто ничего не делает (например, при повторном запуске на
// проде, где админ уже создан вручную/раньше — тут это уже no-op).
migrate((app) => {
  const email = $os.getenv("PB_ADMIN_EMAIL");
  const password = $os.getenv("PB_ADMIN_PASSWORD");

  if (!email || !password) {
    console.log("PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD не заданы — создание первого администратора пропущено");
    return;
  }

  try {
    app.findFirstRecordByFilter("_superusers", "id != ''");
    console.log("Администратор уже существует — пропускаем создание");
    return;
  } catch (_) {
    // суперпользователей ещё нет — создаём первого
  }

  const superusers = app.findCollectionByNameOrId("_superusers");
  const record = new Record(superusers);
  record.set("email", email);
  record.set("password", password);
  app.save(record);

  console.log("Первый администратор создан из PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD");
}, (app) => {
  console.log("Откат: автоматическое удаление первого администратора не выполняется");
})
