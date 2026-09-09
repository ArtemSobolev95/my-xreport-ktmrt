import PocketBase from 'pocketbase';

// Раньше здесь был жёстко зашитый адрес прод-инстанса как fallback — из-за
// этого локальная разработка без .env.local молча ходила в боевую базу.
// Теперь без явно заданной NEXT_PUBLIC_POCKETBASE_URL используем локальный
// адрес и громко предупреждаем, чтобы это не проходило незамеченным.
const POCKETBASE_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL;

if (!POCKETBASE_URL && typeof window !== 'undefined') {
  console.warn(
    '[pocketbase] NEXT_PUBLIC_POCKETBASE_URL не задан — используется http://127.0.0.1:8090. ' +
    'Укажите переменную окружения явно (см. .env.local), если нужен другой адрес.'
  );
}

const pb = new PocketBase(POCKETBASE_URL || 'http://127.0.0.1:8090');

pb.autoCancellation(false);

if (typeof window !== 'undefined') {
  // Загружаем сессию из Local Storage (именно там сейчас хранится авторизация)
  const saved = localStorage.getItem('pocketbase_auth');
  if (saved) {
    try {
      const { token, record } = JSON.parse(saved);
      if (token) pb.authStore.save(token, record);
    } catch (e) {}
  }

  // Сохраняем изменения обратно в Local Storage
  pb.authStore.onChange((token, model) => {
    if (token && model) {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token, record: model }));
    } else {
      localStorage.removeItem('pocketbase_auth');
    }
  });
}

export default pb;