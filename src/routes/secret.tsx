import SEO from "../components/seo";

const Secret = () => {
  return (
    <>
      <SEO
        title="Secret Page"
        description="You found the secret page!"
        url="https://actuallyitsnathaniel.com/secret"
      />
      <div
        id="secret"
        className="flex h-screen w-screen flex-wrap flex-col justify-center"
      >
        <h1 className="sr-only">Secret Page</h1>
        <div className="group w-min mx-auto duration-100 hover:scale-110 hover:text-white">
          👀
        </div>
      </div>
    </>
  );
};

export default Secret;
