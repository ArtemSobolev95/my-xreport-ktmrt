'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import pb from '../lib/pocketbase';
import type { ReactElement } from 'react';

export default function withAuth<P extends object = {}>(
  Component: React.ComponentType<P>
) {
  return function AuthenticatedComponent(props: P): ReactElement {
    const router = useRouter();

    useEffect(() => {
      if (!pb.authStore.isValid) {
        router.replace('/login');
      }
    }, [router]);

    // Всегда рендерим компонент на сервере (чтобы не было hydration error)
    return <Component {...props} />;
  };
}