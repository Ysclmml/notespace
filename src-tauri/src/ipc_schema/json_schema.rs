//! Executable JSON Schemas derived from the same Rust serde payload types that
//! own the IPC event wire format. The TypeScript decoder consumes this artifact
//! generically; event field names never appear in handwritten TypeScript.

use std::collections::BTreeMap;

use schemars::{JsonSchema, Schema, SchemaGenerator};
use serde_json::Value;

use crate::domain::{
    AppCloseRequest, AppError, DocumentExternalChanged, EventScope, NativeOpenResourcesRequested,
    RecoverySnapshotFailed, TaskFinished, TaskProgress, WorkspaceCapabilityChanged,
    WorkspaceFilesChanged,
};

pub fn event_payload_schemas() -> BTreeMap<&'static str, Schema> {
    let mut schemas = BTreeMap::new();
    macro_rules! register_event_schemas {
        ($(($id:literal, $event_type:literal, $payload:ty, $scope:literal, $identity:expr)),+ $(,)?) => {
            $(
                let previous = schemas.insert($event_type, decoder_schema::<$payload>());
                assert!(previous.is_none(), "duplicate event schema: {}", $event_type);
            )+
        };
    }
    event_registry!(register_event_schemas);
    schemas
}

pub fn event_scope_schema() -> Schema {
    decoder_schema::<EventScope>()
}

pub fn app_error_schema() -> Schema {
    decoder_schema::<AppError>()
}

fn decoder_schema<T: JsonSchema>() -> Schema {
    let mut schema = SchemaGenerator::default().into_root_schema_for::<T>();
    strip_null_from_optional_properties(&mut schema);
    schema
}

/// Serde accepts explicit null for `Option<T>`, while the frozen TypeScript
/// contract uses `field?: T`. Remove null only from non-required properties;
/// required wrappers such as `RequiredNullable<T>` keep their null branch.
fn strip_null_from_optional_properties(schema: &mut Schema) {
    fn is_null_schema(value: &Value) -> bool {
        value.get("type").and_then(Value::as_str) == Some("null")
    }

    fn remove_null(schema: &mut Value) {
        let Some(object) = schema.as_object_mut() else {
            return;
        };
        if let Some(Value::Array(types)) = object.get_mut("type") {
            types.retain(|value| value.as_str() != Some("null"));
        }
        for keyword in ["anyOf", "oneOf"] {
            if let Some(Value::Array(variants)) = object.get_mut(keyword) {
                variants.retain(|variant| !is_null_schema(variant));
            }
        }
    }

    fn visit_object(object: &mut serde_json::Map<String, Value>) {
        let required = object
            .get("required")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect::<std::collections::BTreeSet<_>>()
            })
            .unwrap_or_default();
        if let Some(Value::Object(properties)) = object.get_mut("properties") {
            for (name, property_schema) in properties {
                if !required.contains(name) {
                    remove_null(property_schema);
                }
            }
        }
        for child in object.values_mut() {
            visit(child);
        }
    }

    fn visit(value: &mut Value) {
        match value {
            Value::Object(object) => visit_object(object),
            Value::Array(values) => {
                for child in values {
                    visit(child);
                }
            }
            _ => {}
        }
    }

    let Some(object) = schema.as_object_mut() else {
        return;
    };
    visit_object(object);
}
