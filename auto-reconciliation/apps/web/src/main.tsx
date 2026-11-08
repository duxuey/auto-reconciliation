import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { createTrpcClient, trpc } from "./lib/trpc";
import { ScopeProvider } from "./lib/scope";
import { ToastProvider } from "./components/ui/toast";
import "./index.css";

function Main() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false
          }
        }
      })
  );
  const [client] = useState(() => createTrpcClient());

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ScopeProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </ScopeProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

const root = document.getElementById("root");
if (root === null) {
  throw new Error("root element not found");
}
createRoot(root).render(<Main />);
