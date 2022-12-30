// This utility tests our OpenAI Whisper wrapper object.

// Test the route that takes an array of transcript lines that
//  usually come from C# but in this case from a static file, and
//  call our server's route that converts those lines to human
//  consumable content.

// Establish our base directory as being the same as what it would be if
//  this were an express app and the global base directory would have been
//  established by app.js.
const fs = require('fs');
const { resolve, relative } = require('path');
const path = require('path');

global.__basedir = path.resolve(path.join(__dirname, '../'));

const {v4: uuidV4} = require('uuid');

// const fs = require('fs');
const https = require('https');
const http = require('http');

const common_routines = require('../common/common_routines');
const misc_shared_lib = require('../public/javascripts/misc/misc-shared');

const { ChatScriptResponse, queryTheDialogServer_openai_improv_promise } =
    require('../services/chatscript/chatscript-openai');
const { OpenAiFilterAndFix } = require('../OPENAI/output-filter-and-fix');

const {httpsRequestWrapper_GET_jsonobjresult_promise, HttpsRequestWrapperResult} = require("../common/https-request-wrapper");

const errPrefix = 'test-remote-commands.js';

// Phony user ID to act as a simple prevention against unauthorized use.
//  It must match the value expected by the do-transcript-to-content route.
const APPROVED_USER_ID = '9191039484010293939';

// Read/Write JSON easily to/from files.
const jsonfile = require('jsonfile');
const {YouTubeChannelAndVideoDetails} = require("../youtube/youtube-api-support");
const {getVideoAndChannelDetails_promise} = require("../youtube/youtube-api-support");
const {TranscriptLine, TranscriptLineManager, TranscriptParagraph, TranscriptLineTimestamp, DIR_TRANSCRIPT_FILES} = require("../data-objects/transcript-data-objects");

/**
 * This function does the actual work to prepare an array
 * 	of transcript lines for processing by the NLP server.
 *
 * @param {String} userId - The user ID to use with the server call.
 * @param {String} sentenceTopic - The topic that describes the
 * 	general category of the array of transcript lines.
 * @param {TranscriptLineManager} transcriptLineMgrObj -  A valid
 * 	TranscriptLineManager object that contains the information for
 * 	a video.
 * @param {Boolean} bDoAllParagraphs - If TRUE, then the API
 * 	endpoint will repunctuate ALL paragraphs.  Otherwise, only
 * 	SELECTED paragraphs will be repunctuated.
 * @param {Boolean} bSuppressApiCall - If TRUE, then the API call
 * 	to do the actual repunctuation will be suppressed.  This
 * 	context is useful during tuning of the selection algorithms,
 * 	so we don't waste money on redundant Open API calls.
 *
 * @return {Promise<TranscriptLineManager>} - Returns the provided
 * 	TranscriptLineManager with the transcript paragraphs field
 * 	filled in.
 */
async function doProcessTranscriptLines(
    userId,
    sentenceTopic,
    transcriptLineMgrObj,
    bDoAllParagraphs=false,
    bSuppressApiCall=true
) {
    let errPrefix = `(doProcessTranscriptLines) `;

    if (misc_shared_lib.isEmptySafeString(userId))
        throw new Error(errPrefix + `The user_id parameter is empty.`);

    if (misc_shared_lib.isEmptySafeString(sentenceTopic))
        throw new Error(errPrefix + `The sentence_topic parameter is empty.`);

    if (!(transcriptLineMgrObj instanceof TranscriptLineManager))
        throw new Error(errPrefix + `The value in the transcriptLineMgrObj parameter is not a TranscriptLineManager object.`);

    // Extract out the needed fields to process the transcript lines.
    const aryTranscriptLines = transcriptLineMgrObj.array_transcript_lines_objs;
    const videoId = transcriptLineMgrObj.id_of_video;
    const videoTitle = transcriptLineMgrObj.video_title;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    if (!Array.isArray(aryTranscriptLines))
        throw new Error(errPrefix + `The aryTranscriptLines parameter value is not an array.`);

    if (aryTranscriptLines.length < 1)
        throw new Error(errPrefix + `The aryTranscriptLines array is empty`);

    if (misc_shared_lib.isEmptySafeString(videoId))
        throw new Error(errPrefix + `The videoId found in the TranscriptLineManager object is empty.`);

    if (misc_shared_lib.isEmptySafeString(videoTitle))
        throw new Error(errPrefix + `The videoTitle found in the TranscriptLineManager object is empty.`);

    if (misc_shared_lib.isEmptySafeString(videoUrl))
        throw new Error(errPrefix + `The videoUrl found in the TranscriptLineManager object is empty.`);

    if (typeof bDoAllParagraphs !== 'boolean')
        throw new Error(errPrefix + `The value in the bDoAllParagraphs parameter is not boolean.`);

    if (typeof bSuppressApiCall !== 'boolean')
        throw new Error(errPrefix + `The value in the bSuppressApiCall parameter is not boolean.`);


    let payloadObj = {
        // These video details may not actually match the ones that
        //  belong to the static transcript lines array we load for
        //  the test.
        array_transcript_lines: aryTranscriptLines,
        do_all: bDoAllParagraphs ? POST_DATA_FIELD_DO_ALL_MAGIC_VALUE : 'null',
        suppress_api_call: bSuppressApiCall ? 'true' : 'false',
        // Remember, we MUST use a sentence topic that the dialog server
        //  knows how to handle!
        sentence_topic: 'cryptocurrency',
        user_id: userId,
        video_title: videoTitle,
        video_url: videoUrl
    }

    let result =
        await postPayloadObj(
            'localhost',
            7700,
            `/api/do-transcript-to-content/`,
            { payload_object: payloadObj},
            false // Do not use SSL currently since we are running our transcript server on a private network using HTTP.
        )
            .catch(err => {
                // Convert the error to a promise rejection.
                let errMsg =
                    errPrefix + misc_shared_lib.conformErrorObjectMsg(err);

                console.error(errMsg);
            });

    let aryTranscriptParagraphs = [];

    // The result should be an array of result paragraphs.
    if (!Array.isArray(result))
        throw new Error(errPrefix + `The result of the repunctuate API call is not an array.`);

    // Build an array of reconstituted TranscriptParagraph objects.
    for (let ndxTransPara = 0; ndxTransPara < result.length; ndxTransPara++) {
        const rawJsonObj = result[ndxTransPara];
        const transParaObj = TranscriptParagraph.reconstitute(rawJsonObj);

        aryTranscriptParagraphs.push(transParaObj);
    }

    // Fill in the array of transcript paragraph objects field of the TranscriptLineManager
    // object with the array of Transcript paragraphs we just received.
    transcriptLineMgrObj.array_transcript_paragraph_objs = aryTranscriptParagraphs;

    return transcriptLineMgrObj;
}

/**
 * Get a transcript from our transcript server.
 *
 * @param {String} videoId - A valid video ID.
 *
 * @return {Promise<Object>} - Returns a promise that resolves
 *  to the JSON object that or transcript server returns.
 */
function getVideoTranscript_promise(videoId) {
    let errPrefix = '(getVideoTranscript_promise) ';

    return new Promise(function(resolve, reject) {
        try	{
            if (misc_shared_lib.isEmptySafeString(videoId))
                throw new Error(errPrefix + `The videoId parameter is empty.`);

            // Build the URL to get the video transcript from our transcript server
            //  on Station 4.
            const theFullURl = `http://192.168.1.68:13232/transcripts?grab=https://www.youtube.com/watch?v=${videoId}`;

            // FALSE because our transcript server is HTTP and not HTTPS, so don't
            //  use SSL to make the request.
            httpsRequestWrapper_GET_jsonobjresult_promise(theFullURl, false)
                .then(result => {

                    // The result should be a HttpsRequestWrapperResult that contains
                    //  the raw JSON object that contains the list of
                    // Theta TV streamers that are currently broadcasting.
                    if (!(result instanceof HttpsRequestWrapperResult))
                        throw new Error(errPrefix + `The value in the result parameter is not a HttpsRequestWrapperResult object.`);

                    // Did an error occur?
                    let httpsReqWrapResultObj = result;

                    if (httpsReqWrapResultObj.isError)
                        // Yes.  Throw the error message.
                        throw new Error(errPrefix + `An error occurred during the live streams list request: ${httpsReqWrapResultObj.errorDetails}`);

                    if (!misc_shared_lib.isNonNullObjectAndNotArray(httpsReqWrapResultObj.jsonResultObj))
                        throw new Error(errPrefix + `httpsReqWrapResultObj.jsonResultObj is not a valid object.`);

                    // Return it.
                    resolve(httpsReqWrapResultObj.jsonResultObj);
                })
        }
        catch(err) {
            // Convert the error to a promise rejection.
            let errMsg =
                errPrefix + misc_shared_lib.conformErrorObjectMsg(err);

            reject(errMsg + ' - try/catch');
        }
    });
}

/**
 * Takes a transcript stored as a one big string and parses it into an
 * 	array of TranscriptLine objects.
 *
 * @param {String} transcriptAsStr - The transcript of a video in a
 * 	single string.
 *
 * @return {Array<TranscriptLine>} - Returns an array of TranscriptLine
 * 	objects that represent the content of the transcript.
 */
function transcriptAsStrToTranscriptLineObjs(transcriptAsStr) {
    let errPrefix = `(transcriptAsStrToTranscriptLineObjs) `;

    if (misc_shared_lib.isEmptySafeString(transcriptAsStr))
        throw new Error(errPrefix + `The transcriptAsStr parameter is empty.`);

    // Returns a TranscriptLineTimestamp object if the given
    //  string is a transcript timestamp line.  Otherwise,
    //  NULL is returned.
    function parseTimestampLine(str) {
        let errPrefix = `(transcriptAsStrToTranscriptLineObjs::isTimestampLine) `;

        if (misc_shared_lib.isEmptySafeString(str))
            return null;


        let hours = 0;
        let mins = 0;
        let secs = 0;

        // First, try the timestamp with the hours pattern match
        // in the regex pattern.
        const regexWithHours = /^(\d{1,4}):(\d{1,4}):(\d{2})$/gm;

        let mWithHours = regexWithHours.exec(str);
        let strTimestamp = null;

        if (mWithHours) {
            // We have hours.  Parse out hours::minutes::seconds.
            hours = parseInt(mWithHours[1].trim());
            mins = parseInt(mWithHours[2].trim());
            secs = parseInt(mWithHours[3].trim());

            strTimestamp = mWithHours[0].trim();
        } else {
            // We do NOT have hours.  Parse out minutes::seconds.
            const regex = /^(\d{1,4}):(\d{2})$/gm;

            const m = regex.exec(str);

            if (m === null)
                // ---- EXIT ----, we can't parse the string as a timestamp.
                return null;

            mins = parseInt(m[1].trim());
            secs = parseInt(m[2].trim());

            strTimestamp = m[0].trim();
        }

        // Build a TranscriptLineTimestamp object to contain the details.
        let retTimestampLineObj = new TranscriptLineTimestamp();

        retTimestampLineObj.Timestamp_string = strTimestamp;
        retTimestampLineObj.Offset_seconds = (hours * 3600) + (mins * 60) + secs;

        return retTimestampLineObj;
    }

    let retAryTranscriptLineObjs = [];

    // Split the string by line feeds.
    const aryLines = common_routines.splitAndTrimString(transcriptAsStr, '\n');

    if (aryLines.length < 1)
        throw new Error(errPrefix + `No lines were found in the transcript string.`);

    let lastTimestampStr = null;
    let lastTimestampObj = null;

    for (let ndx = 0; ndx < aryLines.length; ndx++) {
        const str = aryLines[ndx];

        if (!misc_shared_lib.isEmptySafeString(str)) {
            // Is it a timestamp line?
            let timestampObj = parseTimestampLine(str);

            if (timestampObj === null) {
                // No, then we assume it is a text line.  We should have
                //  a valid last timestamp object and string.
                if (misc_shared_lib.isEmptySafeString(lastTimestampStr))
                    throw new Error(errPrefix + `Found a text line without a preceding timestamp string.`);
                if (!lastTimestampObj)
                    throw new Error(errPrefix + `Found a text line without a preceding timestamp line object.`);

                //  Create a new TranscriptLine object and accumulate it.

                // We should have a valid timestamp object already.
                const transcriptLineObj = new TranscriptLine();

                transcriptLineObj.Text = str;
                transcriptLineObj.Timestamp_string = lastTimestampObj.Timestamp_string;
                transcriptLineObj.Offset_seconds = lastTimestampObj.Offset_seconds;

                retAryTranscriptLineObjs.push(transcriptLineObj);

                // Reset the last timestamp object and string.
                lastTimestampStr = null;
                lastTimestampObj = null;
            } else {
                // Save the timestamp for the upcoming text line that
                //  it represents.
                lastTimestampStr = str;
                lastTimestampObj = timestampObj;
            }
        }
    }

    return retAryTranscriptLineObjs;
}

/**
 * This function takes a video ID and if possible, loads
 * 	an existing TranscriptLineManager object from storage.
 * 	If an object can not be found in storage, it is built
 * 	by requesting the transcript text for the video from
 * 	our transcript server and then the results are saved to
 * 	storage.
 *
 *
 *
 * @param {string} subDirectoryName - The subdirectory name to
 *  use underneath the transcripts DATA directory.
 * @param {String} videoId - A valid video ID.
 * @param {Boolean} bForceUpdate - If TRUE, then a new copy
 * 	of the transcript for the desired video ID will be
 * 	retrieved even if we already have one stored on disk.
 *
 * @return {Promise<TranscriptLineManager>} - The promise
 * 	resolves to a TranscriptLineManager object that
 * 	represents the content of the video that bears the
 * 	given video ID.
 */
function loadOrCreateTranscriptLineMgrObj_promise(subDirectoryName, videoId, bForceUpdate=false) {
    let errPrefix = '(loadOrCreateTranscriptLineMgrObj_promise) ';

    return new Promise(function(resolve, reject) {
        try	{
            if (misc_shared_lib.isEmptySafeString(subDirectoryName))
                throw new Error(`${errPrefix}The subDirectoryName parameter is empty.`);
            if (misc_shared_lib.isEmptySafeString(videoId))
                throw new Error(errPrefix + `The videoId parameter is empty.`);
            if (typeof bForceUpdate !== 'boolean')
                throw new Error(`${errPrefix}The value in the bForceUpdate parameter is not boolean.`);


            let transcriptLineManagerObj = null;
            let youTubeChannelAndVideoDetailsObj = null;

            if (!bForceUpdate) {
                // Try loading it from disk.
                transcriptLineManagerObj = TranscriptLineManager.loadByVideoId(subDirectoryName, videoId, false);
            }

            // If a forced update is requested OR we couldn't find a TranscriptLineManager
            //  object for the given video ID in storage, do a full video processing
            //  operation.
            if (bForceUpdate || transcriptLineManagerObj === null) {
                // Query the YouTube API and get the video details.
                getVideoAndChannelDetails_promise(videoId)
                    .then(result => {
                        if (!(result instanceof YouTubeChannelAndVideoDetails))
                            throw new Error(errPrefix + `The value in the result parameter is not a YouTubeChannelAndVideoDetails object.`);

                        youTubeChannelAndVideoDetailsObj = result;

                        // Try requesting a transcript for it from our transcript server.
                        return getVideoTranscript_promise(videoId);
                    })
                    .then(result => {
                        if (!misc_shared_lib.isNonNullObjectAndNotArray(result))
                            throw new Error(errPrefix + `The result is of the getVideoTranscript_promise() call i not a valid object.`);

                        // const httpsReqWrapResultObj = result;

                        // Currently the result object is a JSON object with a single field named TranscriptText that
                        //  contains a big string that has the raw transcript content with interleaved timestamps.
                        // if (!('jsonResultObj' in httpsReqWrapResultObj))
                        //	throw new Error(errPrefix + `The result object does not have a "jsonResultObj" field.`);

                        if (!('TranscriptText' in result))
                            throw new Error(errPrefix + `The "jsonResultObj" field field in the result object does not have a "TranscriptText" field.`);

                        const transcriptText = result.TranscriptText.trim();

                        // Parse the transcript text into an array of TranscriptLine objects.
                        const aryTranscriptLineObjs = transcriptAsStrToTranscriptLineObjs(transcriptText);

                        if (!Array.isArray(aryTranscriptLineObjs))
                            throw new Error(errPrefix + `The aryTranscriptLineObjs array is not an array.`);

                        if (aryTranscriptLineObjs.length < 1)
                            throw new Error(errPrefix + `The aryTranscriptLineObjs array is empty.`);

                        // Build a TranscriptLineManager object to hold the text.
                        let newTranscriptLineMgrObj = new TranscriptLineManager();

                        // Fill in the new object's fields.
                        //
                        // FIELD: transcript_text
                        newTranscriptLineMgrObj.transcript_text = transcriptText;

                        // FIELD: array_transcript_lines
                        newTranscriptLineMgrObj.array_transcript_lines_objs = aryTranscriptLineObjs;

                        // FIELD: video_title
                        newTranscriptLineMgrObj.video_title = youTubeChannelAndVideoDetailsObj.video.title;

                        // FIELD: id_of_video
                        newTranscriptLineMgrObj.id_of_video = videoId;

                        // FIELD: video_image_maxres_url
                        //
                        // Use the URL for the highest quality thumbnail.
                        const thumbnailsObj = youTubeChannelAndVideoDetailsObj.video.thumbnails;
                        let useThumbnailObj = null;

                        if (typeof thumbnailsObj.maxres === 'string')
                            useThumbnailObj = thumbnailsObj.maxres;
                        else if (typeof thumbnailsObj.high === 'object')
                            useThumbnailObj = thumbnailsObj.high;
                        else if (typeof thumbnailsObj.medium === 'object')
                            useThumbnailObj = thumbnailsObj.medium;
                        else if (typeof thumbnailsObj.default === 'object')
                            useThumbnailObj = thumbnailsObj.default;

                        if (useThumbnailObj)
                            newTranscriptLineMgrObj.video_image_maxres_url = useThumbnailObj.url;

                        // Save it to storage.
                        TranscriptLineManager.saveToDisk(subDirectoryName, newTranscriptLineMgrObj);

                        // Resolve the promise to the TranscriptLineManager object we
                        //  just created.
                        resolve(newTranscriptLineMgrObj);
                    })
                    .catch(err => {
                        // Convert the error to a promise rejection.
                        let errMsg =
                            errPrefix + misc_shared_lib.conformErrorObjectMsg(err);

                        reject(errMsg + ' - promise');
                    });
            } else {
                // Resolve the promise to the TranscriptLineManager object we
                //  loaded from disk.
                resolve(transcriptLineManagerObj);
            }
        }
        catch(err) {
            // Convert the error to a promise rejection.
            let errMsg =
                errPrefix + misc_shared_lib.conformErrorObjectMsg(err);

            reject(errMsg + ' - try/catch');
        }
    });
}


/**
 * This function executes the test of the remote command bridge.
 *
 * @param {Boolean} bDoAllParagraphs - If TRUE, then the API
 * 	endpoint will repunctuate ALL paragraphs.  Otherwise, only
 * 	SELECTED paragraphs will be repunctuated.
 * @param {Boolean} bSuppressApiCall - If TRUE, then the API call
 * 	to do the actual repunctuation will be suppressed.  This
 * 	context is useful during tuning of the selection algorithms,
 * 	so we don't waste money on redundant Open API calls.
 *
 * @return {Promise<void>}
 */
async function doTest(bDoAllParagraphs, bSuppressApiCall) {
    let errPrefix = `(doTest) `;

    if (typeof bDoAllParagraphs !== 'boolean')
        throw new Error(errPrefix + `The value in the bDoAllParagraphs parameter is not boolean.`);

    if (typeof bSuppressApiCall !== 'boolean')
        throw new Error(errPrefix + `The value in the bSuppressApiCall parameter is not boolean.`);

    if (bSuppressApiCall)
        console.warn(errPrefix + `API calls were suppressed`);

    /*
    const jsonFilename =
        '/home/robert/temp/selenium-test/transcript-lines.json';

    const theVideoId = 'rgQnkCWRh9o';
    const theVideoTitle = 'Mark Cuban talks about Gold';
    const theVideoUrl = 'https://www.youtube.com/watch?v=rgQnkCWRh9o';

    if (!Array.isArray(aryTranscriptLines))
        throw new Error(errPrefix + `The aryTranscriptLines parameter value is not an array.`);

    if (aryTranscriptLines.length < 1)
        throw new Error(errPrefix + `The aryTranscriptLines array is empty.`);

    */

    // Load the existing transcript manager object for the given video ID,
    //  or create one if there is no existing one.
    const videoId = 'rgQnkCWRh9o';
    let transcriptLineManagerObj =
        await loadOrCreateTranscriptLineMgrObj_promise(videoId)
            .catch(err => {
                // Convert the error to a promise rejection.
                let errMsg =
                    errPrefix + misc_shared_lib.conformErrorObjectMsg(err);

                console.log(errPrefix + `The call to loadOrCreateTranscriptLineMgObj_promise() failed.  Details: ${errMsg}.`);

                // Rethrow the error.
                throw(err);
            });

    if (!(transcriptLineManagerObj instanceof TranscriptLineManager))
        throw new Error(errPrefix + `The result of the loadOrCreateTranscriptLineMgObj_promise() is not a TranscriptLineManager object.`);

    // Process the array of transcript lines we received.
    let finalTranscriptLineManagerObj =
        await doProcessTranscriptLines(
            APPROVED_USER_ID,
            'cryptocurrency',
            transcriptLineManagerObj,
            bDoAllParagraphs,
            bSuppressApiCall
        )
            .catch(err => {
                // Convert the error to a promise rejection.
                let errMsg =
                    errPrefix + misc_shared_lib.conformErrorObjectMsg(err);

                console.log(errPrefix + `The call to loadOrCreateTranscriptLineMgObj_promise() failed.  Details: ${errMsg}.`);

                // Rethrow the error.
                throw(err);
            });

    if (!(finalTranscriptLineManagerObj instanceof TranscriptLineManager))
        throw new Error(errPrefix + `The result of the doProcessTranscriptLines() call is not a TranscriptLineManager object.`);

    // Save the results of the transcript operation to disk.
    TranscriptLineManager.saveToDisk(finalTranscriptLineManagerObj);

    // Write the repunctuated text to a file.
    const strFullOrSelect =
        bDoAllParagraphs ? 'full' : 'select';
    const strTemp = misc_shared_lib.makeStringSafe(finalTranscriptLineManagerObj.video_title);
    const safeOutputfileName =
        `${strTemp}-${strFullOrSelect}.txt`;

    // ??? WHERE IS strRepunctuatedText found ???
    const strRepunctuatedText =
        transcriptLinesAryToRepunctStr(
            finalTranscriptLineManagerObj.array_transcript_paragraph_objs,
            bDoAllParagraphs);
    fs.writeFileSync(safeOutputfileName, strRepunctuatedText);

    console.log(`Repunctuated text written to file: ${safeOutputfileName}.`);
    if (bDoAllParagraphs)
        console.log(`MODE: All paragraphs were processed.`);
    else
        console.log(`MODE: Only selected paragraphs were processed.`);

    // return result;

    console.info(`${errPrefix}`, `--- TRANSCRIPT REQUEST FINISHED ----`);
    process.exit(0);
}

/*
function doGrabVideoTranscript(videoHref) {
	const errPrefix = `(doGrabVideoTranscript) `;

	if (misc_shared_lib.isEmptySafeString(videoHref))
		throw new Error(`${errPrefix}The videoHref parameter is empty.`);


}
*/

/**
 * Open a JSON file containing a list of video summary objects
 *  and get transcripts for each video in the file.
 *
 * NOTE: The provided subdirectory will be auto-created
 *  underneath the "transcripts" directory if it does not
 *  exist yet.
 *
 * @param {string} subDirectoryName - The subdirectory name to
 *  use underneath the transcripts DATA directory.
 * @param {string} jsonPlaylistInfoObjFileName - The full path to the
 *  file that contains the playlist items for a particular
 *  channel.
 *
 * @return {Promise<void>}
 */
async function doBatchTranscriptGrab(subDirectoryName, jsonPlaylistInfoObjFileName) {
    const errPrefix = `(doBatchTranscriptGrab) `;

    try {
        if (misc_shared_lib.isEmptySafeString(subDirectoryName))
            throw new Error(`${errPrefix}The subDirectoryName parameter is empty.`);
        if (misc_shared_lib.isEmptySafeString(jsonPlaylistInfoObjFileName))
            throw new Error(`${errPrefix}The jsonPlaylistInfoObj parameter is empty.`);

        // -------------------- BEGIN: OPEN LIST OF VIDEO FILES ------------

        // Load the host object using the JSON file name given to us.
        const playlistInfoObj = jsonfile.readFileSync(jsonPlaylistInfoObjFileName);

        const channelIdPropName = 'channel_id';
        if (!playlistInfoObj.hasOwnProperty(channelIdPropName))
            throw new Error(`${errPrefix}The playlist info object is missing a property named: "${channelIdPropName}"`);

        const channelId = playlistInfoObj[channelIdPropName];

        if (misc_shared_lib.isEmptySafeString(channelId))
            throw new Error(`${errPrefix}The channelId variable is empty.`);

        const aryVideosPropName = 'array_of_videos';
        if (!playlistInfoObj.hasOwnProperty(aryVideosPropName))
            throw new Error(`${errPrefix}The playlist info object is missing a property named: "${aryVideosPropName}"`);

        const aryOfVideoObjs = playlistInfoObj[aryVideosPropName];

        if (!Array.isArray(aryOfVideoObjs))
            throw new Error(`${errPrefix}The aryOfVideoObjs variable is not an array.`);

        if (aryOfVideoObjs.length < 1)
            throw new Error(`${errPrefix}The array of videos is empty.`);

        /*
        const aryOfVideoObjs = jsonfile.readFileSync(jsonPlaylistInfoObjFileName);

        if (!Array.isArray(aryOfVideoObjs))
            throw new Error(`${errPrefix}The file containing the list of videos does not contain an array.`);
        if (aryOfVideoObjs.length < 1)
            throw new Error(`${errPrefix}The file containing the list of videos is empty.`);
        */

        console.info(`Number of videos in the videos list array: ${aryOfVideoObjs.length}`);

        for (let ndx = 0; ndx < aryOfVideoObjs.length; ndx++) {
            const playlistItemObj = aryOfVideoObjs[ndx];

            if (!misc_shared_lib.isNonNullObjectAndNotArray(playlistItemObj))
                throw new Error(`${errPrefix}The playlistItemObj object found at index(${ndx}) is not an object.`);

            if (playlistItemObj.kind != 'youtube#playlistItem') {
                console.warn(`${errPrefix} Skipping non-playlist item element of "kind": ${playlistItemObj.kind}`);
                continue;
            } else {
                let videoId = '(none';

                try {
                    // Process playlist video.
                    // Extract the video ID from the source video URL.  This will also validate
                    //  the URL.
                    // const videoId = misc_shared_lib.extractYouTubeVideoIdFromUrl(videoObj.href);

                    const resourceKind = playlistItemObj.snippet.resourceId.kind;

                    if (resourceKind != 'youtube#video') {
                        console.warn(`${errPrefix} Skipping non-playlist resourceId of "kind": ${resourceKind}`);
                    } else {
                        videoId = playlistItemObj.contentDetails.videoId;
                        const videoTitle = playlistItemObj.snippet.title;
                        // Date/time video was published.  TODO: For processing only new videos later.
                        const videoPublishedAt = playlistItemObj.contentDetails.videoPublishedAt;

                        console.info(`Processing playlist item #(${ndx}) out of: ${aryOfVideoObjs.length}`);
                        console.info(`VIDEO ID: ${videoId}`);
                        console.info(`TITLE: ${videoTitle}`);

                        // Grab the transcript for this video.
                        let transcriptLineManagerObj = null;
                        transcriptLineManagerObj =
                            await loadOrCreateTranscriptLineMgrObj_promise(subDirectoryName, videoId)
                                .catch(err => {
                                    // Convert the error to a promise rejection.
                                    let errMsg =
                                        errPrefix + misc_shared_lib.conformErrorObjectMsg(err);

                                    console.log(errPrefix + `The call to loadOrCreateTranscriptLineMgObj_promise() failed.  Details: ${errMsg}.`);

                                    // Rethrow the error.
                                    throw(err);
                                });
                    }
                } catch (err) {
                    // Log the error and continue, since it might a video
                    //  that had no transcript or the transcript was empty.
                    const errMsg = misc_shared_lib.conformErrorObjectMsg(err);
                    const fullErrMsg = `${errPrefix} - [${new Date()}]\n${errMsg}\nVideo ID: ${videoId}`;

                    // Show an error but don't crash the app.
                    console.error(errPrefix + errMsg);

                    // Log the error to the general transcript error log.
                    common_routines.appendTranscriptErrorLog(fullErrMsg);

                    // Build a JsonErrorObject to hold the error details.
                    const jsonErrObj = new common_routines.JsonErrorObject(videoId, errMsg);

                    // Log the error to the playlist specific error log file.
                    common_routines.appendPlaylistErrorLog(
                        channelId,
                        subDirectoryName,
                        jsonErrObj,
                    );

                    // Write an error object to a file bearing the ID of the
                    //  problem video.
                    TranscriptLineManager.saveErrorObjectToDisk(videoId, subDirectoryName, jsonErrObj);
                }
            }
        } // for()

        // -------------------- END  : OPEN LIST OF VIDEO FILES ------------

        console.info('----- BATCH TRANSCRIPT GRAB COMPLETED. -----')
        process.exit(0);
    } catch (err) {
        const errMsg =
            errPrefix + misc_shared_lib.conformErrorObjectMsg(err);

        console.error(errPrefix + errMsg);
        process.exit(1);
    }
}

/**
 * DEPRECATED: Old input file format used with the Kore AI project.
 *  We are using input files created by the YouTube data API
 *  now.
 *
 * Open a JSON file containing a list of video summary objects
 *  and get transcripts for each video in the file.
 *
 * @return {Promise<void>}
 *
 async function doBatchTranscriptGrab_old_input_file_format(fullJsonFilename) {
	const errPrefix = `(doBatchTranscriptGrab) `;

	try {
		if (misc_shared_lib.isEmptySafeString(fullJsonFilename))
			throw new Error(`${errPrefix}The fullJsonFilename parameter is empty.`);

		// -------------------- BEGIN: OPEN LIST OF VIDEO FILES ------------

		// Load the host object using the JSON file name given to us.
		const aryOfVideoObjs = jsonfile.readFileSync(fullJsonFilename);

		if (!Array.isArray(aryOfVideoObjs))
			throw new Error(`${errPrefix}The file containing the list of videos does not contain an array.`);
		if (aryOfVideoObjs.length < 1)
			throw new Error(`${errPrefix}The file containing the list of videos is empty.`);

		console.info(`Number of videos in the videos list array: ${aryOfVideoObjs.length}`);

		for (let ndx = 0; ndx < aryOfVideoObjs.length; ndx++) {
			const videoObj = aryOfVideoObjs[ndx];

			if (!misc_shared_lib.isNonNullObjectAndNotArray(videoObj))
				throw new Error(`${errPrefix}The video object found at index(${ndx}) is not an object.`);

			if (!videoObj.hasOwnProperty('href'))
				throw new Error(`${errPrefix}The video object found at index(${ndx}) does not have an "href" property.`);
			if (misc_shared_lib.isEmptySafeString(videoObj.href))
				throw new Error(`${errPrefix}The video object found at index(${ndx}) has an empty "href" property.`);

			if (!videoObj.hasOwnProperty('videoTitle'))
				throw new Error(`${errPrefix}The video object found at index(${ndx}) does not have an "videoTitle" property.`);
			if (misc_shared_lib.isEmptySafeString(videoObj.videoTitle))
				throw new Error(`${errPrefix}The video object found at index(${ndx}) has an empty "videoTitle" property.`);

			// Check to see if the video has been marked as not having a transcript, either
			//  because there was no talking during the video or if YouTube simply failed
			//  or could not automatically generate at transcript for it.
			if (typeof videoObj.hasTranscript && videoObj.hasTranscript === false) {
				// Skip this video because it has no transcript
				//  and go on to the next one.
				console.info(`NOTE: This video does NOT have a transcript.  Skipping to the next video.`);
				continue;
			}

			// Extract the video ID from the source video URL.  This will also validate
			//  the URL.
			const videoId = misc_shared_lib.extractYouTubeVideoIdFromUrl(videoObj.href);

			console.info(`Processing video #(${ndx}) out of: ${aryOfVideoObjs.length}.  Video ID: ${videoId}`);
			console.info(`TITLE: ${videoObj.videoTitle}`);
			console.info(`URL: ${videoObj.href}`);

			// Grab the transcript for this video.
			let transcriptLineManagerObj = null;
				try {
					transcriptLineManagerObj =
						await loadOrCreateTranscriptLineMgrObj_promise(videoId)
							.catch(err => {
								// Convert the error to a promise rejection.
								let errMsg =
									errPrefix + misc_shared_lib.conformErrorObjectMsg(err);

								console.log(errPrefix + `The call to loadOrCreateTranscriptLineMgObj_promise() failed.  Details: ${errMsg}.`);

								// Rethrow the error.
								throw(err);
							});
				} catch (err) {
					// Log the error and continue, since it might a video
					//  that had no transcript or the transcript was empty.
					let errMsg = misc_shared_lib.conformErrorObjectMsg(err);

					let fullErrMsg = `${errPrefix} - [${new Date()}]\n${errMsg}\nVideo ID: ${videoId}\n${videoObj.href}`;

					// Show an error but don't crash the app.
					console.error(errPrefix + errMsg);

					// Log the error.
					common_routines.appendTranscriptErrorLog(fullErrMsg)
				}

			// TODO: Remove this once the code is working.
			// break; // STOP AFTER DOING ONE VIDEO FOR NOW.
		}

		// -------------------- END  : OPEN LIST OF VIDEO FILES ------------

		console.info('----- BATCH TRANSCRIPT GRABBED COMPLETED. -----')
		process.exit(0);
	} catch (err) {
		let errMsg =
			errPrefix + misc_shared_lib.conformErrorObjectMsg(err);

		console.error(errPrefix + errMsg);
		process.exit(1);
	}
}
 */

try {
    // Turn off certificate checking since we are calling LOCALHOST.
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

    // Test.
    // const badSentence = 'Even though the economic stakeholders in Bitcoin\'s ecosystem that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part.\n' +
    //	'(TranscriptHelper::doRepunctuateAllParagraphs) Long "transcriptParagraphObj.Text" field in transcript paragraph #(31) AFTER using the carry-forward text: Even though the economic stakeholders in Bitcoin\'s ecosystem that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part of that I\'m a part ddd.'

    const badSentence =
        'However, there\'s one big difference between Gold and Bitcoin and this is that Bitcoin relies on the network to verify transactions However, there\'s one big difference between Gold and Bitcoin, and this is that Bitcoin relies on the However, there\'s one big difference between Gold and Bitcoin and this is that Bitcoin relies on the However, there\'s one big difference between Gold and Bitcoin and this is that Bitcoin relies on the network to function However, there\'s one big difference between Gold and Bitcoin and this is that Bitcoin relies on the Proof of Work algorithm However, there\'s one big difference between Gold and Bitcoin and this is that Bitcoin relies on the creation of new bitcoin to reward miners to process transactions on the network when all the gold gets mined it will still be possible to exchange it but what happens when all the bitcoin is mined will the bitcoin network grind to a halt and bring the entire cryptocurrency space crashing down with it how long do we have before this happens is there a solution to this problem well never fear because today i will answer all these questions and more [Music] \r\n';

    /*
    const badSentence = 'Remember to ping that notification bell, since I won\'t always show up on your YouTube home page if you want to get a sense of what you\'re in for today, well take a peek at those time stamps I\'ve left down below if you see a topic that you just can\'t wait to hear about, well feel free to skip along to it.';
     */

    const fixedSentence = OpenAiFilterAndFix.fixCompletionTextResult(badSentence);

    console.log('Original sentence:');
    console.log(badSentence);
    console.log('Fixed Sentence:');
    console.log(fixedSentence);

    // TRUE(1) does ALL paragraphs, FALSE(1) only does SELECTED paragraphs.
    // TRUE(2) SUPPRESSES the Open API call to repunctuate text, FALSE(2) does not.
    // doTest(false, false);
    // const jsonFilename = '../data/transcripts/videos-list.json';

    // -------------------- BEGIN: LEX FRIDMAN POD-CAST ------------

    // const subDirectoryName = 'lex-fridman-podcast';
    // const playlistId = 'UCSHZKyawb77ixDdsGog4iWA';

    // -------------------- END  : LEX FRIDMAN POD-CAST ------------

    // -------------------- BEGIN: SINGULARITY-NET ------------

    const subDirectoryName = 'singularity-net';
    const playlistId = 'UCzBYOHyEEzlkRdDOSobbpvw';

    // -------------------- END  : SINGULARITY-NET ------------

    const jsonPlaylistInfoFilename =  `../data/playlists/${subDirectoryName}/${playlistId}.json`;
    const fullJsonFilename = path.resolve(jsonPlaylistInfoFilename);

    console.info(`Executing batch transcript grabber run using input file: ${fullJsonFilename}`);

    doBatchTranscriptGrab(subDirectoryName, fullJsonFilename);
} catch(err) {
    // Convert the error to a promise rejection.
    let errMsg =
        errPrefix + misc_shared_lib.conformErrorObjectMsg(err);

    console.error(errPrefix + errMsg);
    process.exit(1);
}