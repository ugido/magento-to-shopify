require('dotenv').config();
const axios = require('axios');
const jsonfile = require('jsonfile');


var shopifySkuIdMap = {};

var magentoInstance = axios.create({
    baseURL: process.env.MAGENTO_URL+'/rest/V1/',
    timeout: 20000,
    headers: {
        'Authorization': `Bearer ${process.env.MAGENTO_API_TOKEN}` 
    },
    validateStatus: function (status) {
        return status >= 200 && status < 500; // default
    },
});


var shopifyInstance = axios.create({
    baseURL: process.env.SHOPIFY_API_URL,
    timeout: 20000,
    headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_API_TOKEN
    },
    validateStatus: function (status) {
        return status >= 200 && status < 500; // default
    },
});


async function createShopifyProduct(productItem){

    var createResponse = await shopifyInstance.post(`products.json`, {
        product: productItem
    });

    if(createResponse.status != 201){
        console.error('ERROR: createShopifyProduct createResponse status= ', createResponse.status, createResponse.data);
        return 0;
    }

    var product = createResponse.data.product;
    
    //console.log('createShopifyProduct id, sku ', product.id, product.variants[0].sku);
    return product;
}


async function updateShopifyProduct(productItem, product_id){

    var updateProductResponse = await shopifyInstance.put(`products/${product_id}.json`, {
        product: {
            title: productItem.title+1,
            body_html: productItem.body_html,
        }
    });

    if(updateProductResponse.status != 200){
        console.error('ERROR: updateShopifyProduct updateProductResponse.status= ', updateProductResponse.status);
        return 0;
    }

    var product = updateProductResponse.data.product;
    var variant_id = product.variants[0].id;

    var updateVariantResponse = await shopifyInstance.put(`variants/${variant_id}.json`, {
        variant: {
            id: variant_id,
            price: productItem.price,
            //inventory_quantity: quantity
        }
    });

    if(updateVariantResponse.status != 200){
        console.error('ERROR: updateShopifyProduct updateVariantResponse.status=', updateVariantResponse.status);
        return 0;
    }
}


async function createShopifyCollection(collectionItem){

    var createResponse = await shopifyInstance.post(`custom_collections.json`, {
        custom_collection: collectionItem
    });

    if(createResponse.status != 201){
        console.error('ERROR: createShopifyCollection createResponse status= ', createResponse.status, createResponse.data);
        return 0;
    }

    var product = createResponse.data.product;
    
    //console.log('createShopifyProduct id, sku ', product.id, product.variants[0].sku);
    return product;
}


async function getMagentoData(key, folder = null, save = true){
    //console.log('getMagentoData: ', key, folder);
    
    var response = await magentoInstance.get(key); // 1194

    if(response.status != 200){
        console.error('ERROR: getMagentoData response status= ', response.status, response.data);
        return null;
    }

    var data = response.data;
    if(save){
        await saveJsonToFile(data, key, folder);
        //var path = folder ? folder : key;
        //jsonfile.writeFileSync(`data/${path}.json`, data); // /${folder}
    }
    
    return data;
}


async function processMagentoCategory(category){
    if(category.id == process.env.MAGENTO_CATEGORY_ID_TO_IGNORE){
        return false;
    }
    console.log('processMagentoCategory: ', category.id);
    var category_id = category.id;
    var categoryItem = await getMagentoData(`categories/${category_id}`, null, false);
    categoryItem.products = await getMagentoData(`categories/${category_id}/products`, null, false);
    await saveJsonToFile(categoryItem, `categories/${category_id}`);

    var children_data = category.children_data;
    var collects = [];

    if(children_data.length === 0){
        collects = categoryItem.products.map(x => {
            return {
                product_id: shopifySkuIdMap[x.sku]
            }
        });
    }
    
    var custom_collection = {
        title: category.name,
        body_html: getMagentoResourceDescription(categoryItem),
        collects: collects,
    }

    await createShopifyCollection(custom_collection);

    for(var i = 0; i< children_data.length; i++){
        await processMagentoCategory(children_data[i]);
        await sleep(2000);
    }
}


async function processMagentoData(){
    var categories = await getMagentoData('categories');
    var category_id = categories.id;
    var products = await getMagentoData(`categories/${category_id}/products`, 'products');

    //await processMagentoCategory(categories);
    await processMagentoProducts(products);
    await getShopifyProductMap();
    await processMagentoCategory(categories);
}


function sleep(ms){
    return new Promise(resolve => setTimeout(resolve, ms));
}


function getMagentoProductImages(product){

    var baseUrl = process.env.MAGENTO_URL;
    var imageFolder = process.env.MAGENTO_PRODUCT_IMAGE_FOLDER;

    return product.media_gallery_entries.map(image => {
        return {src: baseUrl+imageFolder+image.file};
    });
}


function getMagentoResourceDescription(resource){

    var description = '';

    var descriptionObject = resource.custom_attributes
        .find(i => i.attribute_code === 'description');

    if(descriptionObject){
        description = descriptionObject.value;
    }

    if(description && description.includes('{{')){
        description = description.replace(/\{\{[^}]+\}\}/g, '');
        console.error('getMagentoResourceDescription with {{}} id=', resource.id);
    }
    
    return description;
}

async function updateShopifyProductData(product, index){

    var sku = product.sku;

    var item = {
        title: product.name,
        body_html: getMagentoResourceDescription(product),
        images: getMagentoProductImages(product),
        variants: [{sku: sku, price: product.price}]
    };

    if(shopifySkuIdMap[sku]){
        var product_id = shopifySkuIdMap[sku];
        console.log('updateShopifyProductData U sku,id,index=', sku, product_id, index);
        await updateShopifyProduct(item, product_id);
    }
    else {
        console.log('updateShopifyProductData C sku,index=', sku, index);
        await createShopifyProduct(item);
    }
    

    //console.log(item);
}


async function getShopifyProducts(link = null, perPage = 250){

    if(link){
        link = link.replace(process.env.SHOPIFY_API_URL, '');
    }
    else {
        link = 'products.json?limit='+perPage;
    }

    var response = await shopifyInstance.get(link);

    var products = response.data.products;

    for(var i=0; i<products.length; i++){
        var product = products[i];
        var product_id = product.id;
        var sku = product.variants[0].sku;
        shopifySkuIdMap[sku] = product_id;
        //console.log(sku, product_id);
    }

    //console.log('getShopifyProducts: ', products.length, shopifySkuIdMap);

    var link = response.headers.link;
    if(link){
        var links = parseLinkHeader(link);
        if(links.next){
            await sleep(2000);
            await getShopifyProducts(links.next);
        }
        //console.log('link: ', links.next);
    }
}


function parseLinkHeader(data) {
    let arrData = data.split("link:")
    data = arrData.length == 2? arrData[1]: data;
    let parsed_data = {}

    arrData = data.split(",")

    for (d of arrData){
        linkInfo = /<([^>]+)>;\s+rel="([^"]+)"/ig.exec(d)

        parsed_data[linkInfo[2]]=linkInfo[1]
    }

    return parsed_data;
}


async function saveJsonToFile(data, key, folder = null){
    var path = folder ? folder : key;
    jsonfile.writeFileSync(`data/${path}.json`, data);
}


async function getShopifyProductMap(){

    await getShopifyProducts(null);
    console.log('skuMapLength: ', Object.keys(shopifySkuIdMap).length)
    //shopifySkuIdMap
}


async function processMagentoProducts(products){

    for(var i=0; i<products.length; i++){
        if(i<246) continue;
        //if(i > 100) break;
        var product = await getMagentoData(`products/${products[i].sku}`);

        await updateShopifyProductData(product, i);
        await sleep(2000);
    }
}



(async () => {
    await getShopifyProductMap();
    //return;
    await processMagentoData();

})();