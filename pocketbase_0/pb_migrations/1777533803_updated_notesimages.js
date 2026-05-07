/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2201890")

  // update collection data
  unmarshal({
    "name": "notes_images"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2201890")

  // update collection data
  unmarshal({
    "name": "notesimages"
  }, collection)

  return app.save(collection)
})
