import { Hero } from "./Hero";
import { ProjectsSection } from "./ProjectsSection";
import { AudioLabSection } from "./AudioLabSection";
import { PressSection } from "./PressSection";
import { ContactSection } from "./ContactSection";

// The DAW "session view" — all home sections, rendered inside the transport shell.
export function DawHome() {
  return (
    <main className="relative z-[1]">
      <Hero />
      <ProjectsSection />
      <AudioLabSection />
      <PressSection />
      <ContactSection />
    </main>
  );
}
