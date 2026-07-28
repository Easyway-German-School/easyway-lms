import { getDiscourseCategories, getDiscourseSession } from "./discourse";
import { getMoodleCourses, getMoodleSiteInfo } from "./moodle";

export interface LmsConnectorConfig {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
  connectionUrl?: string;
  configured: boolean;
  config: Array<{ key: string; value: string | null }>;
}

const CONNECTOR_DEFINITIONS = [
  {
    id: "moodle",
    name: "Moodle",
    description: "Course management, exams, certificates, and learner portal.",
    docsUrl: "https://moodle.org/",
    envKeys: ["MOODLE_URL", "MOODLE_TOKEN"],
    urlKey: "MOODLE_URL",
  },
  {
    id: "canvas",
    name: "Canvas LMS",
    description: "API-first LMS for courses, grades, assignments, and calendar.",
    docsUrl: "https://www.instructure.com/canvas/",
    envKeys: ["CANVAS_URL", "CANVAS_TOKEN"],
    urlKey: "CANVAS_URL",
  },
  {
    id: "discourse",
    name: "Discourse",
    description: "Community forum platform for discussions and channels.",
    docsUrl: "https://www.discourse.org/",
    envKeys: ["DISCOURSE_URL", "DISCOURSE_API_KEY", "DISCOURSE_API_USERNAME"],
    urlKey: "DISCOURSE_URL",
  },
  {
    id: "open-edx",
    name: "Open edX",
    description: "Powerful open-source learning platform for courses and assessments.",
    docsUrl: "https://open.edx.org/",
    envKeys: ["OPENEDX_URL", "OPENEDX_API_KEY"],
    urlKey: "OPENEDX_URL",
  },
];

export function getLmsConnectors(): LmsConnectorConfig[] {
  return CONNECTOR_DEFINITIONS.map((connector) => {
    const config = connector.envKeys.map((key) => ({ key, value: process.env[key] ?? null }));
    const configured = config.every((entry) => Boolean(entry.value));
    const connectionUrl = process.env[connector.urlKey] || undefined;

    return {
      id: connector.id,
      name: connector.name,
      description: connector.description,
      docsUrl: connector.docsUrl,
      configured,
      connectionUrl,
      config,
    };
  });
}

export type ConnectorTestResult = {
  success: boolean;
  message: string;
  details?: unknown;
};

export type ConnectorDataResult = {
  success: boolean;
  message: string;
  data?: unknown;
  details?: unknown;
};

export function getConnectorById(id: string) {
  return getLmsConnectors().find((connector) => connector.id === id);
}

export async function getConnectorData(connectorId: string): Promise<ConnectorDataResult> {
  const connector = getConnectorById(connectorId);
  if (!connector) {
    return { success: false, message: "Unknown connector" };
  }

  if (!connector.configured) {
    return { success: false, message: "Connector is not configured. Please set the required environment variables." };
  }

  try {
    switch (connectorId) {
      case "moodle": {
        const url = process.env.MOODLE_URL!;
        const token = process.env.MOODLE_TOKEN!;
        const siteInfo = await getMoodleSiteInfo(url, token);
        const courses = await getMoodleCourses(url, token);
        return {
          success: true,
          message: "Moodle data retrieved successfully.",
          data: {
            site: siteInfo,
            courses: Array.isArray(courses) ? courses.slice(0, 20) : courses,
          },
        };
      }
      case "discourse": {
        const url = process.env.DISCOURSE_URL!;
        const apiKey = process.env.DISCOURSE_API_KEY!;
        const apiUsername = process.env.DISCOURSE_API_USERNAME!;
        const session = await getDiscourseSession(url, apiKey, apiUsername);
        const categories = await getDiscourseCategories(url, apiKey, apiUsername);
        return {
          success: true,
          message: "Discourse data retrieved successfully.",
          data: {
            session,
            categories,
          },
        };
      }
      default:
        return { success: false, message: "Data retrieval is not implemented for this connector." };
    }
  } catch (error) {
    return { success: false, message: "Connector data fetch failed.", details: error instanceof Error ? error.message : error };
  }
}

export async function testLmsConnector(connectorId: string): Promise<ConnectorTestResult> {
  const connector = getConnectorById(connectorId);
  if (!connector) {
    return { success: false, message: "Unknown connector" };
  }

  if (!connector.configured) {
    return { success: false, message: "Connector is not configured. Please set the required environment variables." };
  }

  try {
    switch (connectorId) {
      case "moodle": {
        const url = process.env.MOODLE_URL!;
        const token = process.env.MOODLE_TOKEN!;
        return await testMoodle(url, token);
      }
      case "discourse": {
        const url = process.env.DISCOURSE_URL!;
        const apiKey = process.env.DISCOURSE_API_KEY!;
        const apiUsername = process.env.DISCOURSE_API_USERNAME!;
        return await testDiscourse(url, apiKey, apiUsername);
      }
      case "canvas": {
        const url = process.env.CANVAS_URL!;
        const token = process.env.CANVAS_TOKEN!;
        return await testCanvas(url, token);
      }
      case "open-edx": {
        const url = process.env.OPENEDX_URL!;
        const apiKey = process.env.OPENEDX_API_KEY!;
        return await testOpenEdx(url, apiKey);
      }
      default:
        return { success: false, message: "Test not implemented for this connector." };
    }
  } catch (error) {
    return { success: false, message: "Connection test failed.", details: error instanceof Error ? error.message : error };
  }
}

export async function syncLmsConnector(connectorId: string): Promise<ConnectorTestResult> {
  const connector = getConnectorById(connectorId);
  if (!connector) {
    return { success: false, message: "Unknown connector" };
  }

  if (!connector.configured) {
    return { success: false, message: "Connector is not configured. Please set the required environment variables." };
  }

  try {
    switch (connectorId) {
      case "moodle": {
        const url = process.env.MOODLE_URL!;
        const token = process.env.MOODLE_TOKEN!;
        const siteInfo = await getMoodleSiteInfo(url, token);
        const courses = await getMoodleCourses(url, token);
        return {
          success: true,
          message: `Moodle sync ready: ${siteInfo.sitename}. ${courses.length} courses available.`,
          details: { site: siteInfo, courses: courses.slice(0, 10) },
        };
      }
      case "discourse": {
        const url = process.env.DISCOURSE_URL!;
        const apiKey = process.env.DISCOURSE_API_KEY!;
        const apiUsername = process.env.DISCOURSE_API_USERNAME!;
        const session = await getDiscourseSession(url, apiKey, apiUsername);
        const categories = await getDiscourseCategories(url, apiKey, apiUsername);
        return {
          success: true,
          message: `Discourse sync ready: ${session.current_user.username}. ${categories.length} categories available.`,
          details: { session, categories: categories.slice(0, 10) },
        };
      }
      default:
        return { success: false, message: "Sync is not implemented for this connector." };
    }
  } catch (error) {
    return { success: false, message: "Connector sync failed.", details: error instanceof Error ? error.message : error };
  }
}

async function testMoodle(url: string, token: string): Promise<ConnectorTestResult> {
  const endpoint = `${url.replace(/\/+$/, "")}/webservice/rest/server.php?wsfunction=core_webservice_get_site_info&moodlewsrestformat=json&wstoken=${encodeURIComponent(token)}`;
  const response = await fetch(endpoint, { method: "GET" });
  if (!response.ok) {
    return { success: false, message: `Moodle responded with ${response.status}` };
  }
  const data = await response.json();
  return { success: true, message: `Connected to Moodle site: ${data?.sitename || "unknown"}`.trim(), details: data };
}

async function testDiscourse(url: string, apiKey: string, apiUsername: string): Promise<ConnectorTestResult> {
  const endpoint = `${url.replace(/\/+$/, "")}/session/current.json`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Api-Key": apiKey,
      "Api-Username": apiUsername,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    return { success: false, message: `Discourse responded with ${response.status}` };
  }
  const data = await response.json();
  return { success: true, message: `Connected to Discourse user: ${data?.current_user?.username || "unknown"}`.trim(), details: data };
}

async function testCanvas(url: string, token: string): Promise<ConnectorTestResult> {
  const endpoint = `${url.replace(/\/+$/, "")}/api/v1/accounts/self`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    return { success: false, message: `Canvas responded with ${response.status}` };
  }
  const data = await response.json();
  return { success: true, message: `Connected to Canvas account: ${data?.name || "unknown"}`.trim(), details: data };
}

async function testOpenEdx(url: string, apiKey: string): Promise<ConnectorTestResult> {
  const endpoint = `${url.replace(/\/+$/, "")}/api/user/v1/accounts/me`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    return { success: false, message: `Open edX responded with ${response.status}` };
  }
  const data = await response.json();
  return { success: true, message: `Connected to Open edX account: ${data?.name || "unknown"}`.trim(), details: data };
}
