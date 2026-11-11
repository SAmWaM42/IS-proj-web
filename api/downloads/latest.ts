import type { VercelRequest, VercelResponse } from "@vercel/node";

type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type GitHubRelease = {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  assets?: ReleaseAsset[];
};

const RELEASE_REPOSITORY =
  process.env.ANIMAL_AGENT_RELEASE_REPOSITORY ?? "SAmWaM42/IS-proj";

const ASSET_BY_PLATFORM: Record<string, string> = {
  linux: "AnimalAgent-Linux.zip",
  windows: "AnimalAgent-Windows.zip"
};

function queryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function error(res: VercelResponse, status: number, message: string) {
  return res.status(status).json({ error: message });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return error(res, 405, "Method not allowed.");
  }

  const platform = (queryValue(req.query.platform) ?? "").toLowerCase();
  const assetName = ASSET_BY_PLATFORM[platform];
  if (!assetName) {
    return error(res, 400, "Unsupported platform. Use platform=linux or platform=windows.");
  }

  // "latest" includes published prereleases so controlled release-candidate
  // testing can use the same stable download URL. "stable" excludes them.
  const channel = (queryValue(req.query.channel) ?? "latest").toLowerCase();
  if (channel !== "latest" && channel !== "stable") {
    return error(res, 400, "Unsupported channel. Use channel=latest or channel=stable.");
  }

  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");

  try {
    const response = await fetch(
      `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases?per_page=30`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Animal-Agent-Release-Redirect"
        },
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!response.ok) {
      console.error("GitHub Releases lookup failed", response.status);
      return error(res, response.status === 403 ? 503 : 502, "Release information is temporarily unavailable.");
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      return error(res, 502, "GitHub returned an unexpected release response.");
    }

    const releases = (payload as GitHubRelease[])
      .filter((release) => release && release.draft !== true)
      .filter((release) => channel !== "stable" || release.prerelease !== true)
      .sort((a, b) => {
        const aDate = Date.parse(a.published_at ?? "") || 0;
        const bDate = Date.parse(b.published_at ?? "") || 0;
        return bDate - aDate;
      });

    // Select the newest eligible release that actually contains this
    // platform's asset, so a Windows-only release cannot break Linux downloads.
    for (const release of releases) {
      const asset = release.assets?.find((candidate) => candidate.name === assetName);
      const downloadUrl = asset?.browser_download_url;
      if (!downloadUrl || !release.tag_name) continue;

      const parsedUrl = new URL(downloadUrl);
      if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "github.com") {
        console.error("Ignoring unexpected GitHub release asset URL");
        continue;
      }

      res.setHeader("X-Animal-Agent-Version", release.tag_name);
      res.setHeader("X-Animal-Agent-Platform", platform);
      return res.redirect(302, downloadUrl);
    }

    return error(
      res,
      404,
      `No published ${platform} release asset is available yet.`
    );
  } catch (cause) {
    console.error("Release download lookup failed", cause);
    return error(res, 502, "Release information is temporarily unavailable.");
  }
}
