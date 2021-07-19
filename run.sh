#!/bin/bash

# We are the only consumers of this script (within action.yml), so no great need for input validation here
GITHUB_TOKEN=$1
GITHUB_EVENT_NAME=$2
INPUTS_MAIN_BRANCH_NAME=$3
INPUTS_ERROR_ON_NO_SUCCESSFUL_WORKFLOW=$4
INPUTS_WORKFLOW_ID=$5

if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then
    BASE_SHA=$(echo $(git merge-base origin/$INPUTS_MAIN_BRANCH_NAME HEAD))
else
    # For the base SHA for main builds we use the latest matching tag as a marker for the last commit which was successfully built.
    # We use 2> /dev/null to swallow any direct errors from the command itself so we can provide more useful messaging
    BASE_SHA=$(node find-successful-workflow.js $GITHUB_TOKEN $INPUTS_MAIN_BRANCH_NAME $INPUTS_WORKFLOW_ID)

    if [ -z $BASE_SHA ]; then
        if [ $INPUTS_ERROR_ON_NO_SUCCESSFUL_WORKFLOW = "true" ]; then
            echo ""
            echo "ERROR: Unable to find a successful workflow run on 'origin/$INPUTS_MAIN_BRANCH_NAME'"
            echo ""
            echo "NOTE: You have set 'error-on-no-successful-workflow' on the action so this is a hard error."
            echo ""
            echo "Is it possible that you have no runs currently on 'origin/$INPUTS_MAIN_BRANCH_NAME' in your repo?"
            echo ""
            echo "- If yes, then you should run the workflow without this flag first."
            echo "- If no, then you might have changed your git history and those commits no longer exist."
            echo ""

            exit 1
        else
            echo ""
            echo "WARNING: Unable to find a successful workflow run on 'origin/$INPUTS_MAIN_BRANCH_NAME'"
            echo ""
            echo "We are therefore defaulting to use HEAD~1 on 'origin/$INPUTS_MAIN_BRANCH_NAME'"
            echo ""
            echo "NOTE: You can instead make this a hard error by settting 'error-on-no-successful-workflow' on the action in your workflow."
            echo ""

            BASE_SHA=$(echo $(git rev-parse HEAD~1))
        fi
    else
        echo ""
        echo "Found the last successful workflow run on 'origin/$INPUTS_MAIN_BRANCH_NAME'"
        echo ""
        echo "Commit: $BASE_SHA"
        echo ""
    fi
fi

HEAD_SHA=$(git rev-parse HEAD)

echo "::set-output name=base::$BASE_SHA"
echo "::set-output name=head::$HEAD_SHA"
