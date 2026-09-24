declare module 'i18next-resources-to-backend' {
  import type { BackendModule, ReadCallback } from 'i18next';

  type ResourceLoader = (
    language: string,
    namespace: string,
  ) => Promise<unknown> | unknown;

  export default function resourcesToBackend(
    loader: ResourceLoader,
  ): BackendModule<ReadCallback>;
}
