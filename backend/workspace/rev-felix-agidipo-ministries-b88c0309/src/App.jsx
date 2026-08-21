import { Routes, Route } from "react-router-dom";
import Nav from "./components/Nav.jsx";
import Footer from "./components/Footer.jsx";
import Home from "./pages/Home.jsx";
import About from "./pages/About.jsx";
import Activities from "./pages/Activities.jsx";
import Events from "./pages/Events.jsx";
import Sermons from "./pages/Sermons.jsx";
import Gallery from "./pages/Gallery.jsx";
import News from "./pages/News.jsx";
import Contact from "./pages/Contact.jsx";
import Admin from "./pages/Admin.jsx";

export default function App() {
  return (
    <div className="app-shell">
      <Nav />
      <main id="main-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/activities" element={<Activities />} />
          <Route path="/events" element={<Events />} />
          <Route path="/sermons" element={<Sermons />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/news" element={<News />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/admin" element={<Admin />} />
          <Route
            path="*"
            element={
              <div className="not-found">
                <p className="eyebrow">404</p>
                <h1>This page has wandered off the altar.</h1>
                <p>The page you seek could not be found. Return home and begin again.</p>
              </div>
            }
          />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}