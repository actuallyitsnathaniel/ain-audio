import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Root from "../src/routes/root";
import Secret from "../src/routes/secret";
import ErrorPage from "../src/error-page";
import "/src/index.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    errorElement: <ErrorPage />,
    children: [
      {
        path: "#home",
      },
      {
        path: "#about-me",
      },
      {
        path: "/#projects",
        children: [
          { path: "riley" },
          { path: "adidas-messi" },
          { path: "sam-denton" },
          { path: "ryland" },
          { path: "aubit-sound" },
          { path: "john-white" },
          { path: "brand-x" },
          { path: "krptk" },
          { path: "platinum-roses" },
        ],
      },
      {
        path: "#connect",
      },
      {
        path: "#press",
      },
    ],
  },
  { path: "/secret", element: <Secret />, errorElement: <ErrorPage /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
