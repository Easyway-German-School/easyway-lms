export type MoodleSiteInfo = {
  sitename: string;
  username: string;
  fullname: string;
  userlang: string;
  siteurl: string;
  release: string;
};

export type MoodleCourse = {
  id: number;
  shortname: string;
  fullname: string;
  summary: string;
  summaryformat: number;
  format: string;
  startdate: number;
  enddate: number;
};

function cleanUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function buildMoodleUrl(baseUrl: string, params: Record<string, string | number>) {
  const base = cleanUrl(baseUrl);
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => query.append(key, String(value)));
  return `${base}/webservice/rest/server.php?${query.toString()}`;
}

export async function getMoodleSiteInfo(baseUrl: string, token: string): Promise<MoodleSiteInfo> {
  const url = buildMoodleUrl(baseUrl, {
    wstoken: token,
    wsfunction: "core_webservice_get_site_info",
    moodlewsrestformat: "json",
  });
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Moodle site info request failed: ${response.status}`);
  }
  return response.json();
}

export async function getMoodleCourses(baseUrl: string, token: string): Promise<MoodleCourse[]> {
  const url = buildMoodleUrl(baseUrl, {
    wstoken: token,
    wsfunction: "core_course_get_courses",
    moodlewsrestformat: "json",
  });
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Moodle courses request failed: ${response.status}`);
  }
  return response.json();
}
