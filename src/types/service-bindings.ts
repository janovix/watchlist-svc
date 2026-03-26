/**
 * RPC interfaces for service bindings (Thread, Auth, AML).
 * Single source of truth for watchlist-svc and consumers.
 */

export interface ThreadSvcBinding {
	fetch(request: Request | string, init?: RequestInit): Promise<Response>;
	createThread(data: {
		task_type: string;
		job_params?: unknown;
		metadata?: unknown;
	}): Promise<{ id: string; status: string; [key: string]: unknown }>;
	getThread(
		id: string,
	): Promise<{ id: string; status: string; [key: string]: unknown } | null>;
	cancelThread(
		id: string,
	): Promise<{ id: string; status: string; [key: string]: unknown } | null>;
	updateThreadStatus(
		id: string,
		status: string,
		data?: unknown,
	): Promise<{ id: string; status: string; [key: string]: unknown } | null>;
	updateThreadProgress(
		id: string,
		progress: number,
		phase?: string,
	): Promise<{ id: string; status: string; [key: string]: unknown } | null>;
}

export interface AuthServiceBinding {
	fetch(request: Request | string, init?: RequestInit): Promise<Response>;
	getJwks(): Promise<{ keys: unknown[] }>;
	getResolvedSettings(
		userId: string,
		orgId?: string,
		headers?: string,
	): Promise<unknown>;
	gateUsageRights(
		orgId: string,
		metric: string,
		count?: number,
	): Promise<{ allowed: boolean; [key: string]: unknown }>;
	meterUsageRights(
		orgId: string,
		metric: string,
		count?: number,
	): Promise<void>;
	checkUsageRights(
		orgId: string,
		metric: string,
	): Promise<{ allowed: boolean; [key: string]: unknown }>;
	getSubscriptionStatus(orgId: string): Promise<unknown>;
	reportSubscriptionUsage(
		orgId: string,
		metric: string,
		count: number,
	): Promise<void>;
	checkSubscriptionUsage(orgId: string, metric: string): Promise<unknown>;
	checkSubscriptionFeature(orgId: string, feature: string): Promise<unknown>;
	getOrganizationMembers(orgId: string): Promise<
		Array<{
			id: string;
			userId: string;
			role: string;
			email: string;
			name: string;
			image: string | null;
		}>
	>;
}

export interface AmlServiceBinding {
	fetch(request: Request | string, init?: RequestInit): Promise<Response>;
	processScreeningCallback(data: {
		queryId: string;
		type: string;
		status: string;
		matched: boolean;
	}): Promise<void>;
}
