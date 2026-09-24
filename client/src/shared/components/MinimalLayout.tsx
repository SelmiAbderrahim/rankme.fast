import { Outlet } from 'react-router-dom';
import { Footer } from './Footer';
import { Header } from './Header';
import { ReleaseStageBanner } from './ReleaseStageBanner';

/**
 * Guest / pre-auth shell — login, register, password reset, email verification,
 * two-factor, logout. No app sidebar (a logged-out visitor gets no product nav);
 * the shared Header (anon links) + minimal Footer keep one layout language.
 * The main column is the single centering authority for the auth cards
 * (vertically centered, capped at `max-w-md`); the card components themselves
 * no longer re-center, so there is exactly one alignment source.
 */
export const MinimalLayout = () => (
  <div className="flex min-h-dvh flex-col">
    <ReleaseStageBanner />
    <Header />
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12 sm:py-16">
      <Outlet />
    </main>
    <Footer />
  </div>
);
