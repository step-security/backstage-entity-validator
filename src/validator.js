'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const catalogModel = require('@backstage/catalog-model');
const annotationSchema = require('./schemas/annotations.schema.json');
const repositorySchema = require('./schemas/repository.schema.json');
const productSchema = require('./schemas/product.schema.json');

const ajv = new Ajv({ verbose: true });
addFormats(ajv);

function ajvCompiledJsonSchemaValidator(schema) {
  return {
    async check(data) {
      return catalogModel.entityKindSchemaValidator(schema)(data) === data;
    },
  };
}

const VALIDATORS = {
  api: catalogModel.apiEntityV1alpha1Validator,
  component: catalogModel.componentEntityV1alpha1Validator,
  group: catalogModel.groupEntityV1alpha1Validator,
  location: catalogModel.locationEntityV1alpha1Validator,
  user: catalogModel.userEntityV1alpha1Validator,
  system: catalogModel.systemEntityV1alpha1Validator,
  domain: catalogModel.domainEntityV1alpha1Validator,
  resource: catalogModel.resourceEntityV1alpha1Validator,
  repository: ajvCompiledJsonSchemaValidator(repositorySchema),
  product: ajvCompiledJsonSchemaValidator(productSchema),
};

function modifyPlaceholders(obj) {
  for (const k in obj) {
    if (typeof obj[k] === 'object') {
      try {
        if (obj[k].$text || obj[k].$openapi || obj[k].$asyncapi) {
          obj[k] = 'DUMMY TEXT';
          return;
        }
      } catch {
        throw new Error(
          `Placeholder with name '${k}' is empty. Please remove it or populate it.`,
        );
      }
      modifyPlaceholders(obj[k]);
    }
  }
}

const validate = async (
  fileContents,
  verbose = true,
  customAnnotationSchemaLocation = '',
  customAnnotationSchema,
) => {
  let validator;

  const overrides = {
    isValidEntityName(value) {
      return (
        typeof value === 'string' &&
        value.length >= 1 &&
        value.length <= 120 &&
        /^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/.test(value)
      );
    },
    isValidLabelValue(value) {
      return typeof value === 'string';
    },
    isValidTag(value) {
      return (
        typeof value === 'string' && value.length >= 1 && value.length <= 63
      );
    },
  };

  const validateAnnotations = (entity, idx) => {
    if (!validator) {
      if (customAnnotationSchema) {
        const schemaObj = customAnnotationSchema;
        validator = ajv.getSchema(schemaObj.$id);
        if (!validator) {
          validator = ajv.compile(schemaObj);
        }
      } else if (customAnnotationSchemaLocation) {
        console.log(
          `Using validation schema from ${customAnnotationSchemaLocation}...`,
        );
        const schemaFromFile = JSON.parse(
          fs.readFileSync(customAnnotationSchemaLocation, 'utf8'),
        );
        validator = ajv.getSchema(schemaFromFile.$id);
        if (!validator) {
          validator = ajv.compile(schemaFromFile);
        }
      } else {
        validator = ajv.compile(annotationSchema);
      }
    }
    if (verbose) {
      console.log(`Validating entity annotations for file document ${idx}`);
    }
    const result = validator(entity);
    if (result === true) {
      return true;
    }
    const [error] = validator.errors || [];
    if (!error) {
      throw new Error('Malformed annotation, Unknown error');
    }
    throw new Error(
      `Malformed annotation, ${error.instancePath || '<root>'} ${error.message}`,
    );
  };

  try {
    const data = yaml.loadAll(fileContents, null, {
      schema: yaml.CORE_SCHEMA,
    });
    data.forEach((it) => {
      modifyPlaceholders(it);
    });

    const entityPolicies = catalogModel.EntityPolicies.allOf([
      new catalogModel.DefaultNamespaceEntityPolicy(),
      new catalogModel.FieldFormatEntityPolicy(
        catalogModel.makeValidator(overrides),
      ),
      new catalogModel.NoForeignRootFieldsEntityPolicy(),
      new catalogModel.SchemaValidEntityPolicy(),
    ]);

    const responses = await Promise.all(
      data.map((it) => {
        return entityPolicies.enforce(it);
      }),
    );

    const validateEntityKind = async (entity) => {
      const results = {};
      for (const v of Object.entries(VALIDATORS)) {
        const result = await v[1].check(entity);
        results[v[0]] = result;
        if (result === true && verbose) {
          console.log(`Validated entity kind '${v[0]}' successfully.`);
        }
      }
      return results;
    };

    const validateEntities = async (entities) => {
      const results = await Promise.all(entities.map(validateEntityKind));
      return Object.values(results[0]).filter((r) => r === false).length > 0;
    };

    const validKind = await validateEntities(data);
    const validAnnotations = data.map((it, idx) =>
      validateAnnotations(it, idx),
    );

    if (validKind && validAnnotations && verbose) {
      console.log('Entity Schema policies validated\n');
      responses.forEach((it) => console.log(yaml.dump(it)));
    }

    return responses.filter((e) => e !== undefined);
  } catch (e) {
    throw new Error(`Error: ${e instanceof Error ? e.message : String(e)}`);
  }
};

// --- Relative space validation (techdocs) ---

const fileExists = (filePath) => {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const validateTechDocs = async (data, filePath) => {
  if (
    !data?.metadata?.annotations ||
    !data?.metadata?.annotations['backstage.io/techdocs-ref']
  ) {
    return;
  }
  const techDocsAnnotation =
    data.metadata.annotations['backstage.io/techdocs-ref'];
  if (
    !techDocsAnnotation.includes('dir') ||
    techDocsAnnotation.match(/^dir:.$/gm)
  ) {
    return;
  }
  const mkdocsYamlPath = path.join(
    path.dirname(filePath),
    techDocsAnnotation.split(':')[1],
    'mkdocs.yaml',
  );
  const mkdocsYmlPath = path.join(
    path.dirname(filePath),
    techDocsAnnotation.split(':')[1],
    'mkdocs.yml',
  );
  if (!fileExists(mkdocsYamlPath) && !fileExists(mkdocsYmlPath)) {
    throw new Error(
      `Techdocs annotation specifies "dir" but file under ${mkdocsYamlPath}|${mkdocsYmlPath} not found`,
    );
  }
};

const relativeSpaceValidation = async (fileContents, filePath, verbose) => {
  try {
    const data = yaml.loadAll(fileContents, null, {
      schema: yaml.CORE_SCHEMA,
    });
    if (verbose) {
      console.log('Validating locally dependant catalog contents');
    }
    await Promise.all(
      data.map(async (it) => {
        await validateTechDocs(it, filePath);
      }),
    );
  } catch (e) {
    throw new Error(`Error: ${e instanceof Error ? e.message : String(e)}`);
  }
};

// --- Public API ---

const validateFromFile = async (
  filepath,
  verbose = true,
  customAnnotationSchemaLocation = '',
) => {
  const fileContents = fs.readFileSync(filepath, 'utf8');
  if (verbose) {
    console.log(`Validating Entity Schema policies for file ${filepath}`);
  }
  const entities = await validate(
    fileContents,
    verbose,
    customAnnotationSchemaLocation,
  );
  await relativeSpaceValidation(fileContents, filepath, verbose);
  return entities;
};

module.exports = { validate, validateFromFile, relativeSpaceValidation };
