/** Reviewed service boundary. User input can never choose arbitrary modules/endpoints. */
export const serviceSpecs = [
  ['resource.clouds', 'resourcemanager-v1', 'cloudService'],
  ['resource.folders', 'resourcemanager-v1', 'folderService'],
  ['iam.serviceAccounts', 'iam-v1', 'serviceAccountService'],
  ['iam.roles', 'iam-v1', 'roleService'],
  ['iam.keys', 'iam-v1', 'keyService'],
  ['iam.accessKeys', 'iam-v1', 'accessKeyService'],
  ['iam.apiKeys', 'iam-v1', 'apiKeyService'],
  ['compute.instances', 'compute-v1', 'instanceService'],
  ['compute.instanceGroups', 'compute-v1', 'instanceGroupService'],
  ['compute.disks', 'compute-v1', 'diskService'],
  ['compute.images', 'compute-v1', 'imageService'],
  ['compute.snapshots', 'compute-v1', 'snapshotService'],
  ['compute.zones', 'compute-v1', 'zoneService'],
  ['alb.loadBalancers', 'apploadbalancer-v1', 'loadBalancerService'],
  ['alb.backendGroups', 'apploadbalancer-v1', 'backendGroupService'],
  ['alb.targetGroups', 'apploadbalancer-v1', 'targetGroupService'],
  ['alb.httpRouters', 'apploadbalancer-v1', 'httpRouterService'],
  ['alb.virtualHosts', 'apploadbalancer-v1', 'virtualHostService'],
  ['vpc.networks', 'vpc-v1', 'networkService'],
  ['vpc.subnets', 'vpc-v1', 'subnetService'],
  ['vpc.securityGroups', 'vpc-v1', 'securityGroupService'],
  ['vpc.addresses', 'vpc-v1', 'addressService'],
  ['vpc.gateways', 'vpc-v1', 'gatewayService'],
  ['vpc.routeTables', 'vpc-v1', 'routeTableService'],
  ['postgresql.clusters', 'mdb-postgresql-v1', 'clusterService'],
  ['postgresql.databases', 'mdb-postgresql-v1', 'databaseService'],
  ['postgresql.users', 'mdb-postgresql-v1', 'userService'],
  ['postgresql.backups', 'mdb-postgresql-v1', 'backupService'],
  ['storage.buckets', 'storage-v1', 'bucketService'],
  ['registry.registries', 'containerregistry-v1', 'registryService'],
  ['registry.repositories', 'containerregistry-v1', 'repositoryService'],
  ['registry.images', 'containerregistry-v1', 'imageService'],
  ['registry.lifecyclePolicies', 'containerregistry-v1', 'lifecyclePolicyService'],
  ['lockbox.secrets', 'lockbox-v1', 'secretService'],
  ['certificates.certificates', 'certificatemanager-v1', 'certificateService'],
  ['logging.groups', 'logging-v1', 'logGroupService'],
  ['logging.entries', 'logging-v1', 'logReadingService'],
  ['quotas.limits', 'quotamanager-v1', 'quotaLimitService'],
  ['quotas.requests', 'quotamanager-v1', 'quotaRequestService'],
  ['dns.zones', 'dns-v1', 'dnsZoneService'],
  ['monitoring.dashboards', 'monitoring-v3', 'dashboardService'],
  ['operations', 'operation', 'operationService'],
] as const;

/** Credential minting must not create a key whose one-time value is then redacted. */
export const excludedMethod = (service: string, method: string) =>
  (['iam.keys', 'iam.accessKeys', 'iam.apiKeys'].includes(service) && method === 'create') ||
  method === 'getSerialPortOutput';

// Unknown/new SDK methods are writes until explicitly reviewed, never inferred reads.
export const isReadMethod = (service: string, method: string) =>
  /^(get|list)([A-Z]|$)/.test(method) || (service === 'logging.entries' && method === 'read');
