// Main exports
export { extract, check } from './consumer';
export { initPublisher } from './publisher';

// Type exports
export type {
  ConsumerConfig,
  FileFilterConfig,
  ManagedFileMetadata,
  PublishablePackageJson,
} from './types';
export type { PublisherInitOptions, InitResult } from './publisher';
