import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import LiveMap from "./LiveMap.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <LiveMap />
  </StrictMode>
);
