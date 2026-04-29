const core = require('@actions/core');
const glob = require('glob');
const { validateFromFile } = require('./validator');
const axios = require('axios');
const fs = require('fs');

async function validateSubscription() {
  let repoPrivate;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && fs.existsSync(eventPath)) {
    const payload = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    repoPrivate = payload?.repository?.private;
  }

  const upstream = 'roadiehq/backstage-entity-validator';
  const action = process.env.GITHUB_ACTION_REPOSITORY;
  const docsUrl = 'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions';

  core.info('');
  core.info('\u001b[1;36mStepSecurity Maintained Action\u001b[0m');
  core.info(`Secure drop-in replacement for ${upstream}`);
  if (repoPrivate === false) {
    core.info('\u001b[32m\u2713 Free for public repositories\u001b[0m');
  }

  core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`);
  core.info('');

  if (repoPrivate === false) {
    return;
  }

  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const body = { action: action || '' };

  if (serverUrl !== 'https://github.com') {
    body.ghes_server = serverUrl;
  }

  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
      body,
      { timeout: 3000 },
    );
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 403) {
      core.error(
        `\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m`,
      );
      core.error(`\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`);
      process.exit(1);
    }

    core.info('Timeout or API not reachable. Continuing to next step.');
  }
}

const usage = `
Usage: validate-entity [OPTION] [FILE]

Validates Backstage entity definition files.  Files may be specified as
arguments or via STDIN, one per line.

OPTION:
-h  display help
-q  minimal output while validating entities
-i  validate files provided over standard input
-l  location of custom validation schema file
`.trim();

async function validate(files, { github, verbose, validationSchemaFileLocation }) {
  for (const file of files) {
    try {
      if (github) {
        core.setOutput('time', new Date().toTimeString());
      }
 
      await validateFromFile(file, verbose, validationSchemaFileLocation);
    } catch (err) {
      if (github) {
        core.setFailed(`Action failed with error: ${err.message}`);
      } else {
        console.error(`Failed to validate ${file}: ${err.message}`);
      }
      return 1;
    }
  }
  return 0;
}

async function main() {
  if (process.env.GITHUB_ACTIONS) {
    await validateSubscription();
  }
  const argv = require('minimist')(process.argv.slice(2), {
    boolean: ['h', 'i', 'q'],
    default: {
      // help
      h: false,
      // read file(s) to validate from STDIN
      i: false,
      // quiet output
      q: false,
    }
  });

  if (argv.h) {
    console.log(usage);
    return 0;
  }

  const options = {
    verbose: !argv.q,
    github: false,
    validationSchemaFileLocation: argv.l
  };

  // files to validate
  let files = [];

  // this will be empty in non-github environments
  const ghPath = core.getInput('path');
  if (ghPath) {
    // add one or more files seperated by comma
    files = files.concat(ghPath.split(','));
    options.github = true;
  }

  const ghVerbose = core.getInput('verbose');
  if (ghVerbose) {
    options.verbose = ghVerbose === 'true';
  }

  const ghValidationSchemaFileLocation = core.getInput('validationSchemaFileLocation');
  if (ghValidationSchemaFileLocation) {
    options.validationSchemaFileLocation = ghValidationSchemaFileLocation;
  }

  // add files specified as arguments
  files = files.concat(argv._);

  if (argv.i) {
    // add files specified over STDIN
    files = files.concat(require('fs')
      .readFileSync(0)
      .toString()
      .split('\n')
      .filter(l => l.length > 0));
  }

  // Expand glob patterns like services/*/catalog.yaml into a list of files
  files = files.map(file => glob.sync(file)).flat();

  if (files.length === 0) {
    console.error('No files specified to validate');
    return 1;
  }

  return await validate(files, options);
}

// Export for testing
module.exports = { validate, main, usage };

// Only run when executed directly, not when required as a module
if (require.main === module) {
  main().then(process.exit);
}
