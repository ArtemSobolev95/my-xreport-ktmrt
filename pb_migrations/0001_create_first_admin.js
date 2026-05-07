migrate((db) => {
  // Создаём первого админа, если его ещё нет
  const existingAdmins = db.collection("_superusers").findAll({ limit: 1 });

  if (existingAdmins.length === 0) {
    const admin = new Admin();
    admin.email = "artemm.sobolevv@gmail.com";        // ← поменяй на свой email
    admin.setPassword("Artemonetwothree1"); // ← поменяй на свой пароль
    db.save(admin);
    console.log("✅ Первый админ успешно создан");
  } else {
    console.log("Админ уже существует");
  }
}, (db) => {
  // rollback (на всякий случай)
  console.log("Rollback migration");
});
