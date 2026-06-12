import { useParams, Link } from "react-router-dom";
import { projectById } from "../../daw/data/projects";
import { DawShell } from "../../daw/DawShell";
import { DawProjectPage } from "../../daw/DawProjectPage";
import SEO from "../../components/seo";

const SITE = "https://audio.actuallyitsnathaniel.com";

const ProjectPage = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const project = projectId ? projectById(projectId) : undefined;

  if (!project) {
    return (
      <DawShell>
        <main className="relative z-[1] flex min-h-screen flex-col items-center justify-center text-daw-text">
          <h1 className="mb-4 text-4xl font-bold">Project Not Found</h1>
          <Link to="/" className="font-mono text-accent hover:underline">
            ◂ back to session
          </Link>
        </main>
      </DawShell>
    );
  }

  return (
    <DawShell>
      <SEO
        title={`${project.artist} — ${project.subtitle}`}
        description={project.desc}
        url={`${SITE}/projects/${project.id}`}
        type="music.album"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "MusicGroup",
          name: project.artist,
          description: project.desc,
          url: `${SITE}/projects/${project.id}`,
        }}
      />
      <main className="relative z-[1]">
        <DawProjectPage project={project} />
      </main>
    </DawShell>
  );
};

export default ProjectPage;
