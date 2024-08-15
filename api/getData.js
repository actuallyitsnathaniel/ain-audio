/* eslint-disable no-unused-vars */
const handler = async (req, res) => {
  const songstats_artist_api_url = process.env.SONGSTATS_ARTIST_API_URL;
  const songstats_api_key = process.env.SONGSTATS_API_KEY;
  const base_url = process.env.VERCEL_BRANCH_URL
    ? `https://${process.env.VERCEL_BRANCH_URL}`
    : "http://localhost:300";
};

export default handler;
