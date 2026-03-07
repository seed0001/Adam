import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';

// Main Pages
import Home from './pages/Home';
import About from './pages/About';
import Contact from './pages/Contact';

// Sub-Pages
import Blog from './pages/Blog';
import BlogPost from './pages/BlogPost';
import Team from './pages/Team';
import MemberProfile from './pages/MemberProfile';

function AppRoutes() {
  return (
    <Router>
      <Routes>
        {/* Main Pages */}
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />

        {/* Sub-Pages for Blog */}
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/:postId" element={<BlogPost />} />

        {/* Sub-Pages for About/Team */}
        <Route path="/about/team" element={<Team />} />
        <Route path="/about/team/:memberId" element={<MemberProfile />} />
      </Routes>
    </Router>
  );
}

export default AppRoutes;
