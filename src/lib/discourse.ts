export type DiscourseSession = {
  current_user: {
    id: number;
    username: string;
    name: string;
    email: string;
  };
  site: {
    title: string;
    description: string;
  };
};

export type DiscourseCategory = {
  id: number;
  name: string;
  slug: string;
  description: string;
  topic_count: number;
  post_count: number;
};

function cleanUrl(url: string) {
  return url.replace(/\/+$/, "");
}

export async function getDiscourseSession(baseUrl: string, apiKey: string, apiUsername: string): Promise<DiscourseSession> {
  const url = `${cleanUrl(baseUrl)}/session/current.json`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Api-Key": apiKey,
      "Api-Username": apiUsername,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Discourse session request failed: ${response.status}`);
  }

  return response.json();
}

export async function getDiscourseCategories(baseUrl: string, apiKey: string, apiUsername: string): Promise<DiscourseCategory[]> {
  const url = `${cleanUrl(baseUrl)}/site.json`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Api-Key": apiKey,
      "Api-Username": apiUsername,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Discourse categories request failed: ${response.status}`);
  }

  const body = await response.json();
  return (body.categories || []) as DiscourseCategory[];
}
