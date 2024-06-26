AWS.config.region = 'eu-west-3';

AWS.config.credentials = new AWS.CognitoIdentityCredentials({
    IdentityPoolId: 'eu-west-3:0f35e230-b769-43ed-bc1a-58e403f58c4d'
});

const s3 = new AWS.S3();
const bucketName = 'gaillery-img-bucket1';
const dynamoDB = new AWS.DynamoDB.DocumentClient();

const overlay = document.getElementById('overlay');
const statusText = document.getElementById('statusText');
const gallery = document.getElementById('gallery');
const micDiv = document.getElementById('mic-div');
const deleteAllButton = document.getElementById('deleteAllBtn');

let plugin = "";

document.getElementById('fileInput').addEventListener('change', function(event) {
    const files = event.target.files;
    if (files.length > 0) {
        uploadFiles(files);
    }
});

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

document.getElementById('commands-btn').addEventListener('click', () => {
    const commandsModal = document.getElementById('commands-modal');
    if (commandsModal.classList.contains('hidden')) {
        commandsModal.classList.remove('hidden');
        commandsModal.classList.add('block');
    } else {
        commandsModal.classList.add('hidden');
        commandsModal.classList.remove('block');
    }
});

async function uploadFiles(files) {
    overlay.classList.remove('hidden'); 

    for (let index = 0; index < files.length; index++) {
        
        const file = files[index];

        statusText.textContent = `Uploading file ${index + 1} of ${files.length}: ${file.name}`;

        const params = {
            Bucket: bucketName,
            Key: file.name,
            Body: file
        };

        try {

            await AWS.config.credentials.getPromise();
            await s3.upload(params).promise();
            // console.log('Successfully uploaded file.', data);
            statusText.textContent = `Launching Lambda function for ${file.name}...`;
            await checkLambdaFunctionStatus(file.name);
            
        } catch (error) {
            console.error('Error uploading file or processing Lambda:', error);
            statusText.textContent = `Error processing ${file.name}`;
            await sleep(2000);
            overlay.classList.add('hidden'); 
            statusText.textContent = ''; 
            location.reload(); 
        }
    }

    statusText.textContent = `Finishing...`;
    await sleep(3000);
    overlay.classList.add('hidden'); 
    statusText.textContent = ''; 
    location.reload(); 

}

function checkLambdaFunctionStatus(fileName) {
    return new Promise((resolve, reject) => {

        const params = {
            TableName: 'PhotoTags',
            Key: {
                'PhotoID': fileName
            }
        };

        const intervalId = setInterval(async () => {
            try {
                const data = await dynamoDB.get(params).promise();
                const status = data.Item ? data.Item.Status : 'Pending...';
                document.getElementById('statusText').textContent = `Status for ${fileName}: ${status}`;

                if (status === 'Done.') {
                    clearInterval(intervalId);
                    resolve(status); // Resuelve la promesa cuando el estado es Done o Error
                }
                else if(status === 'ERROR'){
                    clearInterval(intervalId);
                    reject(status); // Rechaza la promesa en caso de error
                }
                
            } catch (error) {
                clearInterval(intervalId);
                reject(error); // Rechaza la promesa en caso de error
                console.error("Error fetching status from DynamoDB:", error);
                document.getElementById('statusText').textContent = `Failed to fetch status for ${fileName}: ${error.message}`;
            }
        }, 200);
    });
}

function fetchTags(key, callback) {
    const params = {
        TableName: 'PhotoTags',
        Key: {
            'PhotoID': key
        }
    };
    
    dynamoDB.get(params, function(err, data) {
        if (err) {
            console.error("Error fetching tags from DynamoDB:", err);
        } else {
            callback(data.Item);
        }
    });
}

function loadGallery(showloader = true, tagFilter = false) {

    if (showloader) {
        overlay.classList.remove('hidden');
        statusText.textContent = 'Loading images...';
    }

    micDiv.classList.add('hidden');
    deleteAllButton.classList.add('hidden');

    const params = { Bucket: bucketName };

    s3.listObjectsV2(params, async function(err, data) {
        if (err) {
            console.error('Error listing objects:', err);
            return;
        }

        gallery.innerHTML = '';
        gallery.classList.add('hidden');

        if (data.Contents.length === 0) {
            gallery.innerHTML = '<p class="text-center text-lg m-10 font-bold">No images found.</p>';
            if (showloader){
                overlay.classList.add('hidden');
                gallery.classList.remove('hidden');
                statusText.textContent = '';
            }
            return;
        }

        // const promises = data.Contents.map(item => createImageContainerWithTags(item.Key));
        const promises = data.Contents.map(item => {
            return tagFilter ? fetchAndFilterImage(item.Key, tagFilter) : createImageContainerWithTags(item.Key);
        });

        await Promise.all(promises);

        // sleep(2000);
        if (showloader){
            overlay.classList.add('hidden');
            statusText.textContent = '';
        }
        gallery.classList.remove('hidden');
        micDiv.classList.remove('hidden');
        deleteAllButton.classList.remove('hidden');

        initializeGallery();

    });
    
}

function removeLgContainersExceptLatest() {
    const elements = document.querySelectorAll("[id^='lg-container-']");
    let maxIdNum = 0;
    let maxIdElement = null;

    // Identificar el elemento con el número de ID más alto
    elements.forEach(element => {
        const match = element.id.match(/^lg-container-(\d+)$/);
        if (match) {
            const idNum = parseInt(match[1], 10);
            if (idNum > maxIdNum) {
                maxIdNum = idNum;
                maxIdElement = element;
            }
        }
    });

    // Si hay más de un elemento, eliminar todos excepto el de número más alto
    if (elements.length > 1) {
        elements.forEach(element => {
            if (element !== maxIdElement) {
                element.parentNode.removeChild(element);
            }
        });
    }
}

function fetchAndFilterImage(key, tagFilter) {
    return new Promise((resolve, reject) => {
        fetchTags(key, function(tags) {
            if (tags) {
                const labels = tags.Labels || [];
                const tagFound = labels.some(label => label.Description.toLowerCase() === tagFilter.toLowerCase());
                if (tagFound) {
                    createImageContainerWithTags(key).then(resolve).catch(reject);
                } else {
                    resolve();
                }
            } else {
                resolve();
            }
        });
    });
}

async function createImageContainerWithTags(key) {
    const imageUrl = `https://${bucketName}.s3.${AWS.config.region}.amazonaws.com/${key}`;

    return new Promise((resolve, reject) => {
        fetchTags(key, function(tags) {

            const container = document.createElement('div');
            container.setAttribute('data-src', imageUrl);
            container.className = 'inline-block relative photo-item';

            const img = document.createElement('img');
            img.src = imageUrl;
            img.className = 'block w-full h-auto';
            container.appendChild(img);

            const deleteIcon = document.createElement('div');
            deleteIcon.className = 'hidden delete-icon absolute top-2 right-2 p-1 bg-red-400 hover:bg-red-500 text-white text-center rounded-full cursor-pointer flex items-center justify-center';
            deleteIcon.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="size-3">
                    <path fill-rule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.711Z" clip-rule="evenodd" />
                </svg>`
            ;
            deleteIcon.onclick = function(event) {
                event.stopPropagation(); 
                deleteImage(key);
            };
            container.appendChild(deleteIcon);

            const tagContainer = document.createElement('div');
            tagContainer.className = 'p-2 text-center absolute bottom-0 left-0 w-full text-white bg-black bg-opacity-50 hidden';
            container.appendChild(tagContainer);

            if (tags && tags.Labels) {
                var imgTag = '';
                tags.Labels.forEach(label => {
                    const tag = document.createElement('div');
                    tag.className = 'text-xs';
                    tag.textContent = `${label.Description}: ${label.Probability}`;
                    tagContainer.appendChild(tag);
                    imgTag += `<p>${label.Description} (${label.Probability})</p>`;
                    // img.setAttribute('data-sub-html', imgTag);
                    container.setAttribute('data-sub-html', imgTag);
                });
            }

            container.onmouseover = function() {
                tagContainer.style.display = 'block';
                deleteIcon.style.display = 'block';
            };
            container.onmouseout = function() {
                tagContainer.style.display = 'none';
                deleteIcon.style.display = 'none';
            };

            gallery.appendChild(container);
            resolve();
        });
    });
}

function initializeGallery() {
    $("#gallery").justifiedGallery({
        captions: false,
        rowHeight: 180,
        margins: 5
    }).on("jg.complete", function() {
        plugin = lightGallery(gallery, {
            selector: '.photo-item',
            licenseKey: '765AA57B-7AC54794-8B6C4E56-50182807',
            download: false,
            // subHtmlSelectorRelative: true,
            mobileSettings: {
                controls: true,
                showCloseIcon: true,
                rotate: false
            }
        });
        removeLgContainersExceptLatest();
    });

}

function deleteImage(key) {

    const s3Params = {
        Bucket: bucketName,
        Key: key
    };

    s3.deleteObject(s3Params, function(err, data) {
        if (err) {
            console.error('Error deleting image from S3:', err);
        } else {
            // console.log('Successfully deleted image from S3:', data);
            
            const dynamoDBParams = {
                TableName: 'PhotoTags', // Change this to your DynamoDB table name
                Key: {
                    'PhotoID': key
                }
            };

            dynamoDB.delete(dynamoDBParams, function(err, data) {
                if (err) {
                    console.error('Error deleting tags from DynamoDB:', err);
                } else {
                    // console.log('Successfully deleted tags from DynamoDB:', data);
                    loadGallery(false);
                    // location.reload();
                }
            });

            // Reload gallery without showing loader
            // loadGallery(false);
        }
    });
}

async function uploadRandomImages(numImages = 5) {

    const overlay = document.getElementById('overlay');
    const statusText = document.getElementById('statusText');
    overlay.classList.remove('hidden');

    for (let i = 0; i < numImages; i++) {

        try {
        
            statusText.textContent = `Downloading file ${i + 1} of ${numImages}: random_image_${Date.now()}_${i}.jpg`;
            const response = await fetch(`https://picsum.photos/1024/1024`);
            const blob = await response.blob();

            const params = {
                Bucket: 'gaillery-img-bucket1',
                Key: `random_image_${Date.now()}_${i+1}.jpg`,
                Body: blob,
            };

            statusText.textContent = `Uploading file ${i + 1} of ${numImages}: ${params.Key}`;

            await s3.upload(params).promise();
            statusText.textContent = `Launching Lambda function for ${params.Key}...`;
            await checkLambdaFunctionStatus(params.Key);

        } catch (error) {
            console.error("Failed to fetch or upload image", error);
        }
    }

    statusText.textContent = `Finishing...`;
    await sleep(2000);
    overlay.classList.add('hidden');
    statusText.textContent = '';
    // location.reload();
    loadGallery();
}

async function deleteAllImages() {
    const s3Params = {
        Bucket: bucketName,
    };

    try {
        const data = await s3.listObjectsV2(s3Params).promise();

        const deletePromises = data.Contents.map(async item => {
            const deleteParams = {
                Bucket: bucketName,
                Key: item.Key
            };

            await s3.deleteObject(deleteParams).promise();

            const dynamoDBParams = {
                TableName: 'PhotoTags',
                Key: {
                    'PhotoID': item.Key
                }
            };

            await dynamoDB.delete(dynamoDBParams).promise();
        });

        await Promise.all(deletePromises);

        console.log('All images deleted successfully.');

        location.reload();

    } catch (err) {
        console.error('Error processing deletions:', err);
    }
}

loadGallery();