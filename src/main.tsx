import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { createHead, UnheadProvider } from "@unhead/react/client";
import Root from "../src/routes/root";
import Secret from "../src/routes/secret";
import ErrorPage from "../src/error-page";
import Loader from "../src/components/loader";
import "/src/index.css";

// eslint-disable-next-line react-refresh/only-export-components
const ProjectPage = lazy(() => import("../src/routes/music/project-page"));
// eslint-disable-next-line react-refresh/only-export-components
const EventsPage = lazy(() => import("../src/routes/events"));
// eslint-disable-next-line react-refresh/only-export-components
const UsageAndAiPolicy = lazy(() => import("../src/routes/usage-and-ai-policy"));

const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    errorElement: <ErrorPage />,
  },
  {
    path: "/projects/:projectId",
    element: (
      <Suspense fallback={<Loader />}>
        <ProjectPage />
      </Suspense>
    ),
    errorElement: <ErrorPage />,
  },
  {
    path: "/events",
    element: (
      <Suspense fallback={<Loader />}>
        <EventsPage />
      </Suspense>
    ),
    errorElement: <ErrorPage />,
  },
  {
    path: "/usage-and-ai-policy",
    element: (
      <Suspense fallback={<Loader />}>
        <UsageAndAiPolicy />
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
