import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Root from "/src/routes/root.jsx";
import Secret from "/src/routes/secret.jsx";
import ErrorPage from "/src/error-page.jsx";
import "/src/index.css";

// TODO: refactor projects so that they're integrated with the router
// https://www.google.com/search?sca_esv=7d7eb8bc69b3ea7b&sca_upv=1&sxsrf=ACQVn08iil3sdrJTnWFuTv_vU5qX9o5mHA:1711836874057&q=can+react+router+interact+with+elements+and+unhide+them?&spell=1&sa=X&ved=2ahUKEwifo6qmgZ2FAxUEO0QIHd7EARUQBSgAegQICRAC&biw=1420&bih=855&dpr=2

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
        path: "#music",
        children: [],
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

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
