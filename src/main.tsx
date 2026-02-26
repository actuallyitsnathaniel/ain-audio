import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { createHead, UnheadProvider } from "@unhead/react/client";
import Root from "../src/routes/root";
import Secret from "../src/routes/secret";
import ErrorPage from "../src/error-page";
import "/src/index.css";

// eslint-disable-next-line react-refresh/only-export-components
const ProjectPage = lazy(() => import("../src/routes/music/project-page"));

// Mobile debugging - log device and browser info
console.log("User Agent:", navigator.userAgent);
console.log("Screen:", { width: screen.width, height: screen.height });
console.log("Viewport:", {
  width: window.innerWidth,
  height: window.innerHeight,
});

const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    errorElement: <ErrorPage />,
  },
  {
    path: "/projects/:projectId",
    element: (
      <Suspense
        fallback={
          <div className="flex items-center justify-center min-h-screen text-white">
            Loading...
          </div>
        }
      >
        <ProjectPage />
      </Suspense>
    ),
    errorElement: <ErrorPage />,
  },
  { path: "/secret", element: <Secret />, errorElement: <ErrorPage /> },
]);

const head = createHead();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UnheadProvider head={head}>
      <RouterProvider router={router} />
    </UnheadProvider>
  </React.StrictMode>,
);
