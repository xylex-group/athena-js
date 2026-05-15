import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createPostgresIntrospectionProvider } from '../src/index.ts'

const connectionString = process.env.PG_INTROSPECTION_URL

test('postgres introspection provider captures exhaustive type metadata and relations', async t => {
  if (!connectionString) {
    t.skip('PG_INTROSPECTION_URL is required for integration tests')
    return
  }

  const provider = createPostgresIntrospectionProvider({
    connectionString,
    database: 'athena_js',
  })

  const snapshot = await provider.inspect({
    schemas: ['public', 'analytics'],
  })

  const publicSchema = snapshot.schemas.public
  assert.ok(publicSchema)

  const typeLab = publicSchema.tables.type_lab
  assert.ok(typeLab)
  assert.deepEqual(typeLab.primaryKey, ['id'])
  assert.equal(typeLab.columns.table.isNullable, false)
  assert.equal(typeLab.columns.user.isNullable, true)
  assert.equal(typeLab.columns.order.isNullable, true)
  assert.equal(typeLab.columns['MixedCase'].typeKind, 'scalar')
  assert.equal(typeLab.columns['space name'].typeKind, 'scalar')
  assert.equal(typeLab.columns.mood.typeKind, 'enum')
  assert.deepEqual(typeLab.columns.mood.enumValues, ['happy', 'sad', 'neutral'])
  assert.equal(typeLab.columns.price_domain.typeKind, 'domain')
  assert.equal(typeLab.columns.int_range.typeKind, 'range')
  assert.equal(typeLab.columns.int_multirange.typeKind, 'multirange')
  assert.equal(typeLab.columns.address.typeKind, 'composite')
  assert.equal(typeLab.columns.full_name.isGenerated, true)
  assert.equal(typeLab.columns.first_name.hasDefault, true)
  assert.equal(typeLab.columns.tags.arrayDimensions, 1)
  assert.equal(typeLab.columns.matrix.arrayDimensions, 2)

  const projects = publicSchema.tables.projects
  assert.ok(projects.relations.owner)
  assert.equal(projects.relations.owner.kind, 'many-to-one')

  const users = publicSchema.tables.users
  assert.ok(users.relations.projects)
  assert.equal(users.relations.projects.kind, 'one-to-many')

  const tags = publicSchema.tables.tags
  assert.ok(tags.relations.projects)
  assert.equal(tags.relations.projects.kind, 'many-to-many')

  const analyticsSchema = snapshot.schemas.analytics
  assert.ok(analyticsSchema.tables.users)
})
