import { useEffect } from 'react';
import { TabBar, Spinner } from './components/ui';
import { RouterProvider, useRouter, type Route } from './lib/router';
import { StoreProvider, ToastProvider } from './lib/store';
import { Account, Ledger, Orders } from './pages/Account';
import { Benefit } from './pages/Benefit';
import { Home } from './pages/Home';
import { Rules, Search } from './pages/Misc';
import { Order } from './pages/Order';
import { Ranking } from './pages/Ranking';
import { StockDetail } from './pages/StockDetail';

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'stock':
      return <StockDetail id={route.id} />;
    case 'order':
      return <Order key={route.id} id={route.id} side={route.side} />;
    case 'ledger':
      return <Ledger />;
    case 'orders':
      return <Orders />;
    case 'rules':
      return <Rules />;
    case 'search':
      return <Search />;
  }
}

function Shell() {
  const { tab, stack } = useRouter();
  const top = stack[stack.length - 1];

  // 하위 화면이 열려 있으면 뒤 화면 스크롤을 막아요
  useEffect(() => {
    document.body.style.overflow = top ? 'hidden' : '';
  }, [top]);

  return (
    <>
      <div className="app" aria-hidden={!!top}>
        {tab === 'home' && <Home />}
        {tab === 'account' && <Account />}
        {tab === 'ranking' && <Ranking />}
        {tab === 'benefit' && <Benefit />}
        <TabBar />
      </div>
      {top && (
        <div className="layer" key={stack.length + top.name}>
          <Screen route={top} />
        </div>
      )}
    </>
  );
}

function Splash({ error, retry }: { error?: string; retry?: () => void }) {
  return (
    <div className="splash">
      <div className="logo" aria-hidden>
        ⛅
      </div>
      <div className="t">날씨증권</div>
      {error ? (
        <>
          <div>{error}</div>
          <button className="btn sm" onClick={retry}>
            다시 시도
          </button>
        </>
      ) : (
        <Spinner />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <StoreProvider fallback={(error, retry) => <Splash error={error} retry={retry} />}>
        <RouterProvider>
          <Shell />
        </RouterProvider>
      </StoreProvider>
    </ToastProvider>
  );
}
