[![StepSecurity Maintained Action](https://raw.githubusercontent.com/step-security/maintained-actions-assets/main/assets/maintained-action-banner.png)](https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions)

# Backstage entity validator

## GitHub action

### Inputs

#### `path`

**Optional** Path to the catalog-info.yaml file to validate. Defaults to `catalog-info.yaml` at the root of the repository. It also can be a glob like `services/*/catalog-info.yaml` or a list of files separated by comma `users.yaml,orgs/company.yaml`.

#### `verbose`

**Optional** Specify whether the output should be verbose. Default `true`.

### `validationSchemaFileLocation`
**Optional** Specify the location of the validation schema file.

### Outputs

None. Prints out the validated YAML on success. Prints out errors on invalid YAML

### Example usage
```
- uses:  step-security/backstage-entity-validator@v0
  with:
    path: 'catalog-info-1.yaml'
```

```
- uses:  step-security/backstage-entity-validator@v0
  with:
    path: 'catalog-info-1.yaml,catalog-info-2.yaml,catalog-info-3.yaml'
```

```
- uses:  step-security/backstage-entity-validator@v0
  with:
    path: 'catalog-info-*.yaml,services/**/*/catalog-info.yaml'
```

```
- uses:  step-security/backstage-entity-validator@v0
  with:
    path: 'catalog-info-*.yaml,services/**/*/catalog-info.yaml'
    validationSchemaFileLocation: 'custom-validation-schema.json'
```
