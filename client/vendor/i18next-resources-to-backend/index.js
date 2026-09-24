export default function resourcesToBackend(resources) {
  return {
    type: 'backend',
    init() {},
    read(language, namespace, callback) {
      Promise.resolve()
        .then(() => resources(language, namespace))
        .then((resource) => {
          callback(null, resource && 'default' in resource ? resource.default : resource);
        })
        .catch((error) => callback(error, null));
    },
  };
}
