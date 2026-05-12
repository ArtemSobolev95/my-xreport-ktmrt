import PocketBase from 'pocketbase';

const pb = new PocketBase(
  process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://smartreporting.ru'
);

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